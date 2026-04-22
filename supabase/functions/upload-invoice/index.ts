import { createClient } from "jsr:@supabase/supabase-js@2";
import { S3Client, PutObjectCommand } from "npm:@aws-sdk/client-s3";

/**
 * モバイル等からの一次受け: R2 に保存し document_inbox に1行 INSERT。
 * document_type は NULL（Web の Document Box で仕分け）。
 */
Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const tenantId = formData.get("tenant_id") as string | null;
  if (!file || !tenantId || String(tenantId).trim() === "") {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
    });
  }
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("user_id", user.id)
    .eq("tenant_id", tenantId)
    .single();
  if (profileError || !profile) {
    return new Response(
      JSON.stringify({ error: "Forbidden: not a member of this tenant" }),
      { status: 403 },
    );
  }
  const r2 = new S3Client({
    region: "auto",
    endpoint: Deno.env.get("CF_R2_ENDPOINT")!,
    credentials: {
      accessKeyId: Deno.env.get("CF_R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("CF_R2_SECRET_ACCESS_KEY")!,
    },
  });
  const ext = file.name.split(".").pop() ?? "jpg";
  const key = `${crypto.randomUUID()}.${ext}`;
  const buffer = await file.arrayBuffer();
  await r2.send(
    new PutObjectCommand({
      Bucket: Deno.env.get("CF_R2_BUCKET_NAME")!,
      Key: key,
      Body: new Uint8Array(buffer),
      ContentType: file.type,
    }),
  );
  const { data, error } = await supabase
    .from("document_inbox")
    .insert({
      tenant_id: tenantId,
      value: key,
      file_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
  return new Response(JSON.stringify({ id: data.id }), { status: 200 });
});
