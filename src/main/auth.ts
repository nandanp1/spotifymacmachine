import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";

import { shell } from "electron";

import {
  DEFAULT_SPOTIFY_REDIRECT_URI,
  OAUTH_CALLBACK_HOST,
  OAUTH_CALLBACK_PATH,
  OAUTH_TIMEOUT_MS,
  SPOTIFY_AUTHORIZE_URL,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN_URL,
  TOKEN_REFRESH_SKEW_MS,
} from "../shared/constants";
import { spotifyTokenResponseSchema } from "../shared/schemas";
import type {
  AuthState,
  SpotifyTokenRecord,
  WebPlaybackToken,
} from "../shared/types";
import {
  SecureStoreError,
  type SecureTokenStore,
} from "./secure-store";

export type SpotifyAuthErrorCode =
  | "configuration"
  | "callbackUnavailable"
  | "loginCancelled"
  | "operationCancelled"
  | "stateMismatch"
  | "authorizationRejected"
  | "tokenExchangeRejected"
  | "refreshRejected"
  | "network"
  | "keychain";

export class SpotifyAuthError extends Error {
  readonly code: SpotifyAuthErrorCode;

  constructor(code: SpotifyAuthErrorCode, message: string) {
    super(message);
    this.name = "SpotifyAuthError";
    this.code = code;
  }
}

interface SpotifyAuthOptions {
  clientId?: string;
  redirectUri?: string;
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => Promise<void>;
  now?: () => number;
}

type AuthStateListener = (state: AuthState) => void;

interface AuthLifecycle {
  generation: number;
  signal: AbortSignal;
}

interface TrackedAuthOperation<TResult> {
  generation: number;
  promise: Promise<TResult>;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");

  return { verifier, challenge };
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function validateLoopbackRedirectUri(value: string): URL {
  let redirect: URL;

  try {
    redirect = new URL(value);
  } catch {
    throw new SpotifyAuthError(
      "configuration",
      "The Spotify redirect URI is invalid.",
    );
  }

  if (
    redirect.protocol !== "http:" ||
    redirect.hostname !== OAUTH_CALLBACK_HOST ||
    redirect.pathname !== OAUTH_CALLBACK_PATH ||
    redirect.username !== "" ||
    redirect.password !== "" ||
    redirect.search !== "" ||
    redirect.hash !== "" ||
    redirect.port === ""
  ) {
    throw new SpotifyAuthError(
      "configuration",
      `The Spotify redirect URI must use http://${OAUTH_CALLBACK_HOST}:<port>${OAUTH_CALLBACK_PATH}.`,
    );
  }

  return redirect;
}

export class SpotifyAuthService {
  private readonly clientId: string;
  private readonly redirectUri: string;
  private readonly fetchImpl: typeof fetch;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly now: () => number;
  private readonly listeners = new Set<AuthStateListener>();

  private signInOperation: TrackedAuthOperation<AuthState> | null = null;
  private refreshOperation: TrackedAuthOperation<SpotifyTokenRecord> | null =
    null;
  private lifecycleGeneration = 0;
  private lifecycleController = new AbortController();
  // A sign-out deletion must run after any token write that already crossed
  // its lifecycle guard, so an older operation can never restore credentials.
  private credentialMutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly tokenStore: SecureTokenStore,
    options: SpotifyAuthOptions = {},
  ) {
    this.clientId =
      options.clientId?.trim() ??
      process.env.VITE_SPOTIFY_CLIENT_ID?.trim() ??
      "";
    this.redirectUri =
      options.redirectUri?.trim() ??
      process.env.VITE_SPOTIFY_REDIRECT_URI?.trim() ??
      DEFAULT_SPOTIFY_REDIRECT_URI;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openExternal =
      options.openExternal ??
      ((url: string) => {
        return shell.openExternal(url);
      });
    this.now = options.now ?? Date.now;
  }

  subscribe(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getState(): Promise<AuthState> {
    const lifecycle = this.captureLifecycle();
    let tokens: SpotifyTokenRecord | null;

    try {
      tokens = await this.tokenStore.get();
    } catch (error) {
      if (!this.isCurrentLifecycle(lifecycle)) {
        return { status: "signedOut" };
      }
      return {
        status: "expired",
        reason: error instanceof SecureStoreError ? "keychain" : "unknown",
      };
    }

    if (!this.isCurrentLifecycle(lifecycle)) {
      return { status: "signedOut" };
    }
    if (tokens === null) {
      return { status: "signedOut" };
    }

    if (tokens.expiresAt > this.now() + TOKEN_REFRESH_SKEW_MS) {
      return this.toAuthenticatedState(tokens);
    }

    try {
      return this.toAuthenticatedState(await this.refresh(tokens, lifecycle));
    } catch (error) {
      if (!this.isCurrentLifecycle(lifecycle)) {
        return { status: "signedOut" };
      }
      // A still-valid token remains usable if an early refresh failed because
      // the machine is temporarily offline.
      if (tokens.expiresAt > this.now()) {
        return this.toAuthenticatedState(tokens);
      }

      return {
        status: "expired",
        reason: this.toExpiredReason(error),
      };
    }
  }

  signIn(): Promise<AuthState> {
    const lifecycle = this.captureLifecycle();
    if (this.signInOperation?.generation === lifecycle.generation) {
      return this.signInOperation.promise;
    }

    const operation = this.performSignIn(lifecycle);
    this.signInOperation = {
      generation: lifecycle.generation,
      promise: operation,
    };
    void operation.then(
      () => this.clearSignInOperation(operation),
      () => this.clearSignInOperation(operation),
    );
    return operation;
  }

  async signOut(): Promise<AuthState> {
    this.invalidateLifecycle();
    await this.enqueueCredentialMutation(async () => {
      try {
        await this.tokenStore.delete();
      } catch (error) {
        throw this.mapSecureStoreError(error);
      }
    });

    const state: AuthState = { status: "signedOut" };
    this.emit(state);
    return state;
  }

  async getWebPlaybackToken(): Promise<WebPlaybackToken> {
    const lifecycle = this.captureLifecycle();
    let tokens: SpotifyTokenRecord | null;

    try {
      tokens = await this.tokenStore.get();
    } catch (error) {
      this.assertCurrentLifecycle(lifecycle);
      throw this.mapSecureStoreError(error);
    }

    this.assertCurrentLifecycle(lifecycle);
    if (tokens === null) {
      throw new SpotifyAuthError(
        "refreshRejected",
        "Sign in to Spotify before starting playback.",
      );
    }

    if (tokens.expiresAt <= this.now() + TOKEN_REFRESH_SKEW_MS) {
      tokens = await this.refresh(tokens, lifecycle);
    }
    this.assertCurrentLifecycle(lifecycle);

    // This short-lived value is returned only when the renderer needs to call
    // Spotify's Web API. The renderer must keep it in memory and never persist it.
    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
    };
  }

  private async performSignIn(lifecycle: AuthLifecycle): Promise<AuthState> {
    this.assertCurrentLifecycle(lifecycle);
    this.assertConfigured();
    const redirect = validateLoopbackRedirectUri(this.redirectUri);
    const { verifier, challenge } = createPkcePair();
    const expectedState = createOAuthState();
    const authorizationUrl = new URL(SPOTIFY_AUTHORIZE_URL);

    authorizationUrl.searchParams.set("client_id", this.clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", redirect.toString());
    authorizationUrl.searchParams.set("state", expectedState);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));

    const code = await this.waitForAuthorizationCode(
      redirect,
      expectedState,
      authorizationUrl.toString(),
      lifecycle,
    );
    const payload = await this.requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect.toString(),
        client_id: this.clientId,
        code_verifier: verifier,
      }),
      "tokenExchangeRejected",
      lifecycle,
    );

    if (payload.refresh_token === undefined) {
      throw new SpotifyAuthError(
        "tokenExchangeRejected",
        "Spotify did not provide a renewable session.",
      );
    }

    const tokens: SpotifyTokenRecord = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type,
      scopes: this.parseScopes(payload.scope),
      expiresAt: this.now() + payload.expires_in * 1_000,
    };

    await this.persistTokens(tokens, lifecycle);

    const state = this.toAuthenticatedState(tokens);
    this.emit(state, lifecycle);
    this.assertCurrentLifecycle(lifecycle);
    return state;
  }

  private refresh(
    tokens: SpotifyTokenRecord,
    lifecycle: AuthLifecycle,
  ): Promise<SpotifyTokenRecord> {
    this.assertCurrentLifecycle(lifecycle);
    if (this.refreshOperation?.generation === lifecycle.generation) {
      return this.refreshOperation.promise;
    }

    const operation = this.performRefresh(tokens, lifecycle);
    this.refreshOperation = {
      generation: lifecycle.generation,
      promise: operation,
    };
    void operation.then(
      () => this.clearRefreshOperation(operation),
      () => this.clearRefreshOperation(operation),
    );
    return operation;
  }

  private async performRefresh(
    current: SpotifyTokenRecord,
    lifecycle: AuthLifecycle,
  ): Promise<SpotifyTokenRecord> {
    this.assertCurrentLifecycle(lifecycle);
    this.assertConfigured();
    const payload = await this.requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: this.clientId,
      }),
      "refreshRejected",
      lifecycle,
    );
    const next: SpotifyTokenRecord = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? current.refreshToken,
      tokenType: payload.token_type,
      scopes:
        payload.scope === undefined
          ? current.scopes
          : this.parseScopes(payload.scope),
      expiresAt: this.now() + payload.expires_in * 1_000,
    };

    await this.persistTokens(next, lifecycle);

    this.emit(this.toAuthenticatedState(next), lifecycle);
    this.assertCurrentLifecycle(lifecycle);
    return next;
  }

  private async requestToken(
    body: URLSearchParams,
    rejectionCode: "tokenExchangeRejected" | "refreshRejected",
    lifecycle: AuthLifecycle,
  ) {
    this.assertCurrentLifecycle(lifecycle);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const abortForLifecycle = () => {
      controller.abort(lifecycle.signal.reason);
    };
    lifecycle.signal.addEventListener("abort", abortForLifecycle, {
      once: true,
    });

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(SPOTIFY_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
          signal: controller.signal,
        });
      } catch {
        this.assertCurrentLifecycle(lifecycle);
        throw new SpotifyAuthError(
          "network",
          "Spotify could not be reached. Check the network and try again.",
        );
      }

      clearTimeout(timeout);
      this.assertCurrentLifecycle(lifecycle);
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        this.assertCurrentLifecycle(lifecycle);
        throw new SpotifyAuthError(
          rejectionCode,
          "Spotify returned an invalid authentication response.",
        );
      }
      this.assertCurrentLifecycle(lifecycle);

      if (!response.ok) {
        throw new SpotifyAuthError(
          rejectionCode,
          rejectionCode === "refreshRejected"
            ? "The Spotify session could not be refreshed."
            : "Spotify rejected the sign-in request.",
        );
      }

      const parsed = spotifyTokenResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new SpotifyAuthError(
          rejectionCode,
          "Spotify returned an invalid authentication response.",
        );
      }

      return parsed.data;
    } finally {
      clearTimeout(timeout);
      lifecycle.signal.removeEventListener("abort", abortForLifecycle);
    }
  }

  private async waitForAuthorizationCode(
    redirect: URL,
    expectedState: string,
    authorizationUrl: string,
    lifecycle: AuthLifecycle,
  ): Promise<string> {
    this.assertCurrentLifecycle(lifecycle);
    let resolveCode: (code: string) => void = () => undefined;
    let rejectCode: (error: Error) => void = () => undefined;
    let completed = false;

    const codeResult = new Promise<string>((resolve, reject) => {
      resolveCode = resolve;
      rejectCode = reject;
    });

    const server = createServer((request, response) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", redirect.origin);
      } catch {
        this.respondToCallback(
          response,
          400,
          "Aura Player",
          "The sign-in response was invalid.",
        );
        return;
      }

      if (
        request.method !== "GET" ||
        requestUrl.pathname !== redirect.pathname
      ) {
        this.respondToCallback(response, 404, "Aura Player", "Not found.");
        return;
      }

      if (completed) {
        this.respondToCallback(
          response,
          410,
          "Aura Player",
          "This sign-in attempt has already finished.",
        );
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      if (
        returnedState === null ||
        !this.constantTimeEquals(returnedState, expectedState)
      ) {
        completed = true;
        this.respondToCallback(
          response,
          400,
          "Aura Player",
          "The sign-in response could not be verified.",
        );
        rejectCode(
          new SpotifyAuthError(
            "stateMismatch",
            "The Spotify sign-in response could not be verified.",
          ),
        );
        return;
      }

      const oauthError = requestUrl.searchParams.get("error");
      if (oauthError !== null) {
        completed = true;
        this.respondToCallback(
          response,
          400,
          "Aura Player",
          oauthError === "access_denied"
            ? "Spotify sign-in was cancelled. You can close this tab."
            : "Spotify could not complete sign-in. You can close this tab.",
        );
        rejectCode(
          new SpotifyAuthError(
            oauthError === "access_denied"
              ? "loginCancelled"
              : "authorizationRejected",
            oauthError === "access_denied"
              ? "Spotify sign-in was cancelled."
              : "Spotify rejected the authorization request.",
          ),
        );
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (code === null || code.length === 0 || code.length > 2_048) {
        completed = true;
        this.respondToCallback(
          response,
          400,
          "Aura Player",
          "Spotify did not return a valid authorization code.",
        );
        rejectCode(
          new SpotifyAuthError(
            "authorizationRejected",
            "Spotify did not return a valid authorization code.",
          ),
        );
        return;
      }

      completed = true;
      this.respondToCallback(
        response,
        200,
        "Aura Player is connected",
        "Return to Aura Player. You can close this tab.",
      );
      resolveCode(code);
    });

    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.maxHeadersCount = 32;

    try {
      await this.listenOnLoopback(server, Number(redirect.port));
    } catch (error) {
      this.assertCurrentLifecycle(lifecycle);
      throw error;
    }
    server.on("error", () => {
      if (!completed) {
        completed = true;
        rejectCode(
          new SpotifyAuthError(
            "callbackUnavailable",
            "The local Spotify sign-in callback stopped unexpectedly.",
          ),
        );
      }
    });

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new SpotifyAuthError(
            "loginCancelled",
            "Spotify sign-in timed out.",
          ),
        );
      }, OAUTH_TIMEOUT_MS);
    });
    let handleLifecycleAbort = () => undefined;
    const cancellationResult = new Promise<never>((_resolve, reject) => {
      handleLifecycleAbort = () => {
        completed = true;
        reject(this.createOperationCancelledError());
      };
      if (lifecycle.signal.aborted) {
        handleLifecycleAbort();
      } else {
        lifecycle.signal.addEventListener("abort", handleLifecycleAbort, {
          once: true,
        });
      }
    });
    const completion = Promise.race([
      codeResult,
      timeoutResult,
      cancellationResult,
    ]);

    try {
      await Promise.race([
        this.openExternal(authorizationUrl),
        cancellationResult,
      ]);
      return await completion;
    } catch (error) {
      this.assertCurrentLifecycle(lifecycle);
      if (error instanceof SpotifyAuthError) {
        throw error;
      }
      throw new SpotifyAuthError(
        "callbackUnavailable",
        "The Spotify sign-in page could not be opened.",
      );
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      lifecycle.signal.removeEventListener("abort", handleLifecycleAbort);
      await this.closeServer(server);
    }
  }

  private listenOnLoopback(server: Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = () => {
        reject(
          new SpotifyAuthError(
            "callbackUnavailable",
            `Aura Player could not listen on ${OAUTH_CALLBACK_HOST}:${port}.`,
          ),
        );
      };

      server.once("error", onError);
      server.listen(
        {
          host: OAUTH_CALLBACK_HOST,
          port,
          exclusive: true,
        },
        () => {
          server.off("error", onError);
          resolve();
        },
      );
    });
  }

  private closeServer(server: Server): Promise<void> {
    if (!server.listening) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  private respondToCallback(
    response: ServerResponse,
    status: number,
    title: string,
    message: string,
  ): void {
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;

    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      Connection: "close",
    });
    response.end(body);
  }

  private constantTimeEquals(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);

    return (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    );
  }

  private assertConfigured(): void {
    if (this.clientId.length === 0 || this.clientId.length > 200) {
      throw new SpotifyAuthError(
        "configuration",
        "Set VITE_SPOTIFY_CLIENT_ID before signing in.",
      );
    }
  }

  private parseScopes(scope = ""): string[] {
    return [...new Set(scope.split(/\s+/).filter(Boolean))].sort();
  }

  private toAuthenticatedState(tokens: SpotifyTokenRecord): AuthState {
    return {
      status: "authenticated",
      expiresAt: tokens.expiresAt,
      scopes: [...tokens.scopes],
    };
  }

  private toExpiredReason(error: unknown): Extract<
    AuthState,
    { status: "expired" }
  >["reason"] {
    if (error instanceof SpotifyAuthError) {
      if (error.code === "configuration") {
        return "configuration";
      }
      if (error.code === "network") {
        return "network";
      }
      if (error.code === "refreshRejected") {
        return "refreshRejected";
      }
      if (error.code === "keychain") {
        return "keychain";
      }
    }
    return "unknown";
  }

  private mapSecureStoreError(error: unknown): SpotifyAuthError {
    if (error instanceof SecureStoreError) {
      return new SpotifyAuthError(
        "keychain",
        error.code === "keychainUnavailable"
          ? "The macOS Keychain is unavailable."
          : "The saved Spotify session is invalid. Sign out and try again.",
      );
    }

    return new SpotifyAuthError(
      "keychain",
      "The Spotify session could not be accessed securely.",
    );
  }

  private captureLifecycle(): AuthLifecycle {
    return {
      generation: this.lifecycleGeneration,
      signal: this.lifecycleController.signal,
    };
  }

  private invalidateLifecycle(): void {
    this.lifecycleGeneration += 1;
    this.lifecycleController.abort(this.createOperationCancelledError());
    this.lifecycleController = new AbortController();
  }

  private isCurrentLifecycle(lifecycle: AuthLifecycle): boolean {
    return (
      lifecycle.generation === this.lifecycleGeneration &&
      !lifecycle.signal.aborted
    );
  }

  private assertCurrentLifecycle(lifecycle: AuthLifecycle): void {
    if (!this.isCurrentLifecycle(lifecycle)) {
      throw this.createOperationCancelledError();
    }
  }

  private createOperationCancelledError(): SpotifyAuthError {
    return new SpotifyAuthError(
      "operationCancelled",
      "The Spotify authentication operation was cancelled by sign-out.",
    );
  }

  private persistTokens(
    tokens: SpotifyTokenRecord,
    lifecycle: AuthLifecycle,
  ): Promise<void> {
    return this.enqueueCredentialMutation(async () => {
      this.assertCurrentLifecycle(lifecycle);
      try {
        await this.tokenStore.set(tokens);
      } catch (error) {
        this.assertCurrentLifecycle(lifecycle);
        throw this.mapSecureStoreError(error);
      }
      this.assertCurrentLifecycle(lifecycle);
    });
  }

  private enqueueCredentialMutation<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.credentialMutationQueue.then(operation);
    this.credentialMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private clearSignInOperation(operation: Promise<AuthState>): void {
    if (this.signInOperation?.promise === operation) {
      this.signInOperation = null;
    }
  }

  private clearRefreshOperation(
    operation: Promise<SpotifyTokenRecord>,
  ): void {
    if (this.refreshOperation?.promise === operation) {
      this.refreshOperation = null;
    }
  }

  private emit(state: AuthState, lifecycle?: AuthLifecycle): void {
    for (const listener of this.listeners) {
      if (lifecycle && !this.isCurrentLifecycle(lifecycle)) {
        return;
      }
      try {
        listener(state);
      } catch {
        // A renderer listener must never interrupt token persistence.
      }
    }
  }
}
