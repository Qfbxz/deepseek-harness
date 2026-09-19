# Agent Note: Catalog-route model discovery asks the endpoint first

Status: implemented

English | [中文](2026-08-27-catalog-route-discovery-asks-endpoint.zh.md)

## Problem

"Fetch available models" on a built-in provider route answered from the pi-ai catalog bundled with the build and never touched the network. The catalog is a build-time snapshot (pi-ai 0.82.1, generated 2026-07-25), so models a provider released after the snapshot — Zhipu's `glm-5.3` and `glm-5.3-flash` in the reported case — could never appear, no matter what key the user entered. The action's own promise, a current list from the provider, was unfulfillable by construction on every route the catalog ships, which is where most users start. The endpoint was never the problem: `GET /models` on the Zhipu routes answers the standard OpenAI listing shape.

## Decision

`discoverModels` treats a catalog route's bundled entries as the fallback, not the answer. A route the installed catalog ships now asks its own endpoint first — the `baseURL` the draft names, else the catalog provider's own — and overlays the reply on the installed entries: the endpoint's ids are the current answer in endpoint order, a disclosed capacity beats the bundled one, and an entry the catalog also describes takes the installed name and capacities wherever the listing is silent. Every inability to ask folds into the registry fallback: a route whose protocols have no readable listing, no endpoint anywhere, a credential that cannot resolve or cannot ride a header, and every refusal or fault the endpoint answers with. Cancellation alone surfaces, as `ABORTED`. A route the catalog does not describe is unchanged: interrogated over the wire alone, refusals surfaced.

The network interrogation is one shared `interrogateListing` helper; the draft path keeps its coded failures, and the catalog path catches them into the fallback.

## Alternatives considered

**Keep the registry answer and wait for a pi-ai upgrade.** Rejected: the snapshot ages the day it is generated, and the complaint is about models that exist today. A catalog-refresh cycle would still leave every build stale between releases.

**Drop the catalog short-circuit and always interrogate.** Rejected: it would dead-end offline users and turn every non-listable catalog route (anthropic, bedrock, azure, codex) into `DISCOVERY_UNSUPPORTED`, regressing the guarantee the short-circuit was introduced for — that a catalog route always answers.

**Fall back except on auth refusals, so a wrong key still surfaces.** Rejected: the first-run posture — no key stored or typed yet — probes unauthenticated, so it would trade the registry answer for a "check the API key" error the user cannot act on yet. The probe is a candidate list, not a credential test; the draft route remains where credential faults surface.

**Let a named-but-missing stored credential fail the catalog discovery loudly.** Rejected: discovery is a candidate listing, not a credential health check. A profile that names an `apiKeyEnv` whose secret is not stored folds into the registry answer here by design; the request path still raises `MISSING_CREDENTIAL`, which is where credential health belongs and where the user can act on it.

## Consequences

A catalog-route fetch costs a network round trip where it previously cost nothing, and a slow provider endpoint delays the picker where the registry answered instantly; the fallback bounds the failure, not the latency. A user with a wrong stored key sees the bundled list rather than an auth error — the same answer as before the change — so the picker's list is current exactly when the endpoint can answer, and the route's credential health is still proven only by a request. Tests pin the overlay order and capacities, every fallback fold, the no-listing and no-endpoint postures, and that cancellation still surfaces.
