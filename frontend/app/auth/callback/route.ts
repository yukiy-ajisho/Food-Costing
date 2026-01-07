import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    try {
      const cookieStore = await cookies();

      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
              try {
                cookiesToSet.forEach(({ name, value, options }) =>
                  cookieStore.set(name, value, options)
                );
              } catch {
                // The `setAll` method was called from a Server Component.
                // This can be ignored if you have middleware handling
                // cookie setting.
              }
            },
          },
        }
      );

      // Exchange code for session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("Exchange error:", error);
        return NextResponse.redirect(
          `${requestUrl.origin}/login?error=auth_failed`
        );
      }

      // Verify session
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        console.error("Session verification failed:", sessionError);
        return NextResponse.redirect(
          `${requestUrl.origin}/login?error=session_failed`
        );
      }

      // Check for autoAcceptToken parameter (invitation auto-accept flow)
      const autoAcceptToken = requestUrl.searchParams.get("autoAcceptToken");
      if (autoAcceptToken) {
        try {
          // Call backend to accept invitation
          const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
          const response = await fetch(`${API_URL}/invite/accept`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ token: autoAcceptToken }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            console.error("Failed to accept invitation:", errorData);
            return NextResponse.redirect(
              `${requestUrl.origin}/join?token=${autoAcceptToken}&error=accept_failed`
            );
          }

          // Success - redirect to cost page
          return NextResponse.redirect(new URL("/cost", requestUrl.origin));
        } catch (error) {
          console.error("Error accepting invitation:", error);
          return NextResponse.redirect(
            `${requestUrl.origin}/join?token=${autoAcceptToken}&error=accept_failed`
          );
        }
      }

      // Check for returnUrl parameter (e.g., from invitation flow)
      const returnUrl = requestUrl.searchParams.get("returnUrl");
      if (returnUrl) {
        // Validate returnUrl to prevent open redirect
        try {
          const returnUrlObj = new URL(returnUrl, requestUrl.origin);
          // Only allow relative URLs from same origin
          if (returnUrlObj.origin === requestUrl.origin) {
            return NextResponse.redirect(returnUrlObj);
          }
        } catch (e) {
          console.error("Invalid returnUrl:", e);
        }
      }

      // Redirect to cost page after successful authentication
      return NextResponse.redirect(new URL("/cost", requestUrl.origin));
    } catch (error) {
      console.error("Unexpected error:", error);
      return NextResponse.redirect(
        `${requestUrl.origin}/login?error=auth_failed`
      );
    }
  } else {
    console.error("No authorization code provided");
    return NextResponse.redirect(`${requestUrl.origin}/login?error=no_code`);
  }
}
