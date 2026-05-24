import { redirect } from "next/navigation";

// Passwordless magic-link auth: there is no separate registration. Entering an
// email on /login creates the account on first sign-in. Keep this route as a
// redirect so existing links don't 404.
export default function RegisterPage() {
  redirect("/login");
}
