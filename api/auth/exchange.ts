import type { VercelRequest, VercelResponse } from "@vercel/node";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

interface ExchangeRequestBody {
  code?: unknown;
}

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({
      error: "server_misconfigured",
      error_description:
        "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set on the server.",
    });
    return;
  }

  const body = (req.body ?? {}) as ExchangeRequestBody;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    res.status(400).json({
      error: "missing_code",
      error_description: "Request body must include a non-empty `code` field.",
    });
    return;
  }

  try {
    const ghRes = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const data = (await ghRes.json()) as GitHubTokenResponse;

    if (data.error || !data.access_token) {
      res.status(400).json({
        error: data.error ?? "exchange_failed",
        error_description:
          data.error_description ?? "GitHub did not return an access token.",
      });
      return;
    }

    res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      refresh_token_expires_in: data.refresh_token_expires_in,
      token_type: data.token_type,
      scope: data.scope,
    });
  } catch (err) {
    res.status(502).json({
      error: "github_unreachable",
      error_description: (err as Error).message,
    });
  }
}
