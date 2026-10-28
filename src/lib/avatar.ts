import { supabase } from "./supabase";

export const avatarUrl = (seed: string, style = "lorelei") =>
  `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`;

export const randomAvatarSeed = () =>
  `${["Mango", "Maple", "Mitti", "Mogra", "Nadi", "Sitar", "Chai", "Badal"][Math.floor(Math.random() * 8)]}-${Math.random().toString(36).slice(2, 8)}`;

export async function uploadAvatar(
  userId: string,
  seed: string,
  style: string,
): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const response = await fetch(avatarUrl(seed, style));
  if (!response.ok) throw new Error("Could not generate the selected avatar. Please try again.");
  const svg = await response.blob();
  const path = `${userId}/avatar.svg`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, svg, { contentType: "image/svg+xml", upsert: true });

  if (uploadError) throw new Error(`Avatar could not be saved: ${uploadError.message}`);

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_seed: seed, avatar_style: style, avatar_path: path })
    .eq("id", userId);

  if (profileError) throw new Error(`Avatar was uploaded but the profile could not be updated: ${profileError.message}`);
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}
