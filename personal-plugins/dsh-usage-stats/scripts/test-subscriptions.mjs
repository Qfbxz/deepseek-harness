import assert from "node:assert/strict";
import { collectSubscriptions, subscriptionCredentialRefs } from "../lib/subscriptions.js";

function credentials(values) {
	return {
		resolve: async (ref) => Object.hasOwn(values, ref) ? { value: values[ref] } : void 0
	};
}

const now = Date.parse("2026-08-14T00:00:00Z");
const noLocalAuth = {
	homedir: () => "/test-home",
	readFile: async () => { throw new Error("missing"); }
};

{
	const providers = await collectSubscriptions(credentials({}), {}, { ...noLocalAuth, now: () => now });
	assert.deepEqual(providers.map((provider) => [provider.id, provider.status]), [
		["opencode-go", "not-configured"],
		["zai", "not-configured"]
	]);
	assert.deepEqual(providers[0].missingCredentials, [subscriptionCredentialRefs.openCodeApiKey]);
	console.log("not-configured states ok");
}

{
	const calls = [];
	const secret = "sk-opencode-test";
	const providers = await collectSubscriptions(credentials({ OPENCODE_GO_API_KEY: secret }), {}, {
		...noLocalAuth,
		now: () => now,
		fetch: async (url, init) => {
			calls.push({ url: String(url), init });
			if (String(url).includes("api.z.ai")) return { ok: false, status: 401, json: async () => ({}) };
			return {
				ok: true,
				status: 200,
				json: async () => ({ usage: {
					rolling: { status: "ok", percent: 9, resetsAt: "2026-08-14T07:20:04.810Z" },
					weekly: { status: "ok", percent: 12, resetsAt: "2026-08-17T00:00:00.810Z" },
					monthly: { status: "ok", percent: 6, resetsAt: "2026-09-09T00:41:03.810Z" }
				} })
			};
		}
	});
	const go = providers[0];
	assert.equal(go.status, "ok");
	assert.deepEqual(go.windows.map((window) => [window.kind, window.usedPercent]), [["session", 9], ["weekly", 12], ["monthly", 6]]);
	assert.equal(calls[0].url, "https://opencode.ai/zen/go/v1/usage");
	assert.equal(calls[0].init.headers.authorization, `Bearer ${secret}`);
	assert.equal(JSON.stringify(go).includes(secret), false, "API key must not cross the module interface");
	console.log("OpenCode Go Bearer endpoint normalization ok");
}

{
	const calls = [];
	const secret = "super-secret-cookie";
	const providers = await collectSubscriptions(credentials({
		OPENCODE_GO_AUTH_COOKIE: secret,
		OPENCODE_GO_WORKSPACE_ID: "https://opencode.ai/workspace/wrk_TEST/go"
	}), {}, {
		...noLocalAuth,
		now: () => now,
		fetch: async (url, init) => {
			calls.push({ url: String(url), init });
			return {
				ok: true,
				status: 200,
				text: async () => JSON.stringify({
					rollingUsage: { usagePercent: 12, resetInSec: 3600 },
					weeklyUsage: { usagePercent: 34, resetInSec: 86400 },
					monthlyUsage: { usagePercent: 56, resetInSec: 2592000 }
				})
			};
		}
	});
	const go = providers[0];
	assert.equal(go.status, "ok");
	assert.deepEqual(go.windows.map((window) => [window.kind, window.usedPercent]), [["session", 12], ["weekly", 34], ["monthly", 56]]);
	assert.equal(calls[0].url, "https://opencode.ai/workspace/wrk_TEST/go");
	assert.equal(calls[0].init.headers.cookie, `auth=${secret}`);
	assert.equal(JSON.stringify(go).includes(secret), false, "cookie must not cross the module interface");
	console.log("OpenCode Go dashboard normalization ok");
}

{
	const calls = [];
	const providers = await collectSubscriptions(credentials({}), {}, {
		homedir: () => "/users/demo",
		readFile: async (path) => {
			assert.equal(String(path).replaceAll("\\", "/"), "/users/demo/.local/share/opencode/auth.json");
			return JSON.stringify({ "opencode-go": { type: "api", key: "local-opencode-key" } });
		},
		now: () => now,
		fetch: async (url, init) => {
			calls.push(String(url));
			assert.equal(init.headers.authorization, "Bearer local-opencode-key");
			return { ok: true, status: 200, json: async () => ({ usage: { rolling: { percent: 1 }, weekly: { percent: 2 }, monthly: { percent: 3 } } }) };
		}
	});
	assert.equal(providers[0].status, "ok");
	assert.deepEqual(calls, ["https://opencode.ai/zen/go/v1/usage"]);
	console.log("OpenCode auth.json fallback ok");
}

{
	const calls = [];
	const secret = "zai-secret-key";
	const providers = await collectSubscriptions(credentials({ ZAI_API_KEY: secret }), {}, {
		...noLocalAuth,
		now: () => now,
		fetch: async (url, init) => {
			calls.push({ url: String(url), init });
			if (String(url).endsWith("/quota/limit")) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ data: { limits: [
						{ type: "TOKENS_LIMIT", unit: 3, number: 5, usage: 1000, currentValue: 120, remaining: 850 },
						{ type: "CREDIT_LIMIT", unit: 6, number: 1, percentage: 25 },
						{ type: "TIME_LIMIT", remaining: 9, percentage: 40 }
					] } })
				};
			}
			return { ok: true, status: 200, json: async () => ({ data: [{ product_name: "GLM Coding Pro", next_renew_time: "2026-09-01T00:00:00Z" }] }) };
		}
	});
	const zai = providers[1];
	assert.equal(zai.status, "ok");
	assert.equal(zai.plan, "GLM Coding Pro");
	assert.deepEqual(zai.windows.map((window) => [window.kind, Math.round(window.usedPercent)]), [["session", 15], ["weekly", 25], ["billing", 40]]);
	assert.deepEqual(calls.map((call) => call.url), [
		"https://api.z.ai/api/monitor/usage/quota/limit",
		"https://api.z.ai/api/biz/subscription/list"
	]);
	assert.ok(calls.every((call) => call.init.headers.authorization === `Bearer ${secret}`));
	assert.equal(JSON.stringify(zai).includes(secret), false, "API key must not cross the module interface");
	console.log("Z.ai quota normalization ok");
}

{
	const providers = await collectSubscriptions(credentials({ ZAI_API_KEY: "x", ZAI_API_REGION: "cn" }), {}, {
		...noLocalAuth,
		now: () => now,
		fetch: async (url) => {
			assert.match(String(url), /^https:\/\/open\.bigmodel\.cn\//);
			return { ok: false, status: 401, json: async () => ({}) };
		}
	});
	assert.equal(providers[1].region, "bigmodel-cn");
	assert.equal(providers[1].status, "unauthorized");
	console.log("Z.ai region and auth error mapping ok");
}

console.log("SUBSCRIPTION TESTS PASSED");
