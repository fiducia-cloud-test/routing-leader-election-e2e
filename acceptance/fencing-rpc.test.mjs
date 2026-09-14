import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.ACCEPTANCE_BASE_URL || "http://127.0.0.1:8790";
const object = "leader-election-rpc";
const resource = "route:registry-primary";

async function call(path, params) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries({ object, ...params })) url.searchParams.set(key, String(value));
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.json();
}

test("actual Durable Object RPC enforces leader fencing across release/reacquire", async () => {
  const health = await call("/health", {});
  assert.equal(health.durable_object, "FiduciaLeaseCoordinator");
  assert.equal(health.storage, "sqlite");
  assert.equal(health.rpc, true);

  const first = await call("/acquire", { resource, holder: "leader-a", ttl_ms: 60_000 });
  assert.equal(first.acquired, true);
  assert.equal(first.lease.holder, "leader-a");
  const token1 = first.lease.fencing_token;
  assert.ok(Number.isSafeInteger(token1) && token1 > 0);

  const blocked = await call("/acquire", { resource, holder: "leader-b", ttl_ms: 60_000 });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.lease.holder, "leader-a");
  assert.equal(blocked.lease.fencing_token, token1);

  const renewed = await call("/acquire", { resource, holder: "leader-a", ttl_ms: 120_000 });
  assert.equal(renewed.acquired, true);
  assert.equal(renewed.lease.fencing_token, token1, "renewal must not mint a new fencing token");

  const staleRelease = await call("/release", { resource, holder: "leader-a", fencing_token: token1 + 1 });
  assert.equal(staleRelease.released, false);

  const wrongHolder = await call("/release", { resource, holder: "leader-b", fencing_token: token1 });
  assert.equal(wrongHolder.released, false);

  const released = await call("/release", { resource, holder: "leader-a", fencing_token: token1 });
  assert.equal(released.released, true);

  const second = await call("/acquire", { resource, holder: "leader-b", ttl_ms: 60_000 });
  assert.equal(second.acquired, true);
  assert.equal(second.lease.holder, "leader-b");
  assert.ok(second.lease.fencing_token > token1, "new leader must receive a strictly newer fencing token");
});

test("expired leader can be replaced without an explicit release and token advances", async () => {
  const expiringResource = "route:ephemeral-leader";
  const first = await call("/acquire", { resource: expiringResource, holder: "leader-a", ttl_ms: 1_000 });
  assert.equal(first.acquired, true);
  const token1 = first.lease.fencing_token;

  await new Promise((resolve) => setTimeout(resolve, 1_100));

  const takeover = await call("/acquire", { resource: expiringResource, holder: "leader-b", ttl_ms: 1_000 });
  assert.equal(takeover.acquired, true);
  assert.equal(takeover.lease.holder, "leader-b");
  assert.ok(takeover.lease.fencing_token > token1, "expiry takeover must advance the fencing token");

  const staleOldLeaderRelease = await call("/release", { resource: expiringResource, holder: "leader-a", fencing_token: token1 });
  assert.equal(staleOldLeaderRelease.released, false, "expired former leader must not release the replacement lease");
});
