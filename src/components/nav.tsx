import { getCurrentUser } from "@/lib/auth";
import { NavbarClient } from "./navbar-client";

export async function Nav() {
  const user = await getCurrentUser();
  return <NavbarClient role={user?.role ?? null} />;
}
