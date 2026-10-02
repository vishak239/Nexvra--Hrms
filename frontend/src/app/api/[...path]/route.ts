import { proxyToBackend } from "@/lib/proxy";

// Every /api/* request is forwarded to Django at request time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = (req: Request) => proxyToBackend(req);

export { handler as DELETE, handler as GET, handler as HEAD, handler as OPTIONS, handler as PATCH, handler as POST, handler as PUT };
