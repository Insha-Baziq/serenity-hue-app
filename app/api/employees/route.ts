import { createEmployee } from "@/lib/repository";
import { requireApiSession } from "@/lib/auth-guard";
import { rateLimitedResponse, takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await requireApiSession(request))) return Response.json({ message: "Authentication required" }, { status: 401 });
  const limit = takeRateLimit(request, { name: "employee-create", limit: 10, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await request.json() as { name?: unknown; email?: unknown; password?: unknown };
  } catch {
    return Response.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 2) return Response.json({ message: "Enter the employee's full name" }, { status: 400 });
  if (!/^\S+@\S+\.\S+$/.test(email)) return Response.json({ message: "Enter a valid email address" }, { status: 400 });
  if (password.length < 8) return Response.json({ message: "Password must be at least 8 characters" }, { status: 400 });

  try {
    const employee = await createEmployee({ name, email, password });
    return Response.json({ employee }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "EMPLOYEE_ALREADY_EXISTS") {
      return Response.json({ message: "An employee with that email already exists" }, { status: 409 });
    }
    return Response.json({ message: "Unable to create the employee right now" }, { status: 500 });
  }
}
