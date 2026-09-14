import { FiduciaLeaseCoordinator } from "../source/fiducia-infra/modules/cloudflare/durable-coordinator/worker.mjs";

export { FiduciaLeaseCoordinator };

function required(url, name) {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`missing_${name}`);
  return value;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const objectName = url.searchParams.get("object") || "routing-leader-election";
    const stub = env.COORDINATOR.getByName(objectName);
    if (url.pathname === "/health") return Response.json(await stub.health());
    if (url.pathname === "/acquire") {
      return Response.json(await stub.acquireLease(required(url, "resource"), required(url, "holder"), Number(required(url, "ttl_ms"))));
    }
    if (url.pathname === "/release") {
      return Response.json({ released: await stub.releaseLease(required(url, "resource"), required(url, "holder"), Number(required(url, "fencing_token"))) });
    }
    return new Response("Not Found", { status: 404 });
  },
};
