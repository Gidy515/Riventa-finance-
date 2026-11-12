import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

export async function postNearRpc(
  rpcUrl: string,
  body: string,
  timeoutMs = 5000
): Promise<string> {
  const url = new URL(rpcUrl);

  if (url.protocol !== "https:") {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  const addresses = await dnsLookup(url.hostname, {
    all: true,
    family: 4,
    verbatim: true,
  });

  if (addresses.length === 0) {
    throw new Error("NEAR_RPC_UNAVAILABLE");
  }

  let lastError: unknown;

  for (const address of addresses) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: url.hostname,
            port: url.port ? Number(url.port) : 443,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
            lookup: (_hostname, options, callback) => {
              if (
                typeof options === "object" &&
                options !== null &&
                "all" in options &&
                options.all
              ) {
                callback(null, [
                  {
                    address: address.address,
                    family: address.family,
                  },
                ]);
              } else {
                callback(null, address.address, address.family);
              }
            },
            timeout: timeoutMs,
          },
          (response) => {
            let responseBody = "";

            response.setEncoding("utf8");

            response.on("data", (chunk) => {
              responseBody += chunk;
            });

            response.on("end", () => {
              if (
                !response.statusCode ||
                response.statusCode < 200 ||
                response.statusCode >= 300
              ) {
                reject(
                  new Error(
                    `NEAR_RPC_HTTP_ERROR_${response.statusCode ?? "UNKNOWN"}`
                  )
                );
                return;
              }

              resolve(responseBody);
            });
          }
        );

        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error("NEAR_RPC_TIMEOUT"));
        });

        request.on("error", reject);

        request.end(body);
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("NEAR_RPC_UNAVAILABLE");
}
