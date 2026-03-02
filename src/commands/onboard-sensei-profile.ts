/**
 * Sensei Profile — onboarding step that collects user preferences
 * so Arona can personalize interactions.
 *
 * Writes a populated USER.md to the workspace directory.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { WizardPrompter } from "../wizard/prompts.js";

export interface SenseiProfile {
  name: string;
  callAs: string;
  location: string;
  birthday: string;
  hobbies: string;
  favoriteGames: string;
  notes: string;
}

/**
 * Prompt the user for their profile information.
 * All fields are optional — hitting Enter skips them.
 */
export async function promptSenseiProfile(prompter: WizardPrompter): Promise<SenseiProfile> {
  await prompter.note(
    [
      "Arona muốn biết thêm về Sensei để trò chuyện tự nhiên hơn!",
      "Bấm Enter để bỏ qua bất kỳ câu hỏi nào.",
      "",
      "Arona wants to learn about Sensei for better conversations!",
      "Press Enter to skip any question.",
    ].join("\n"),
    "👤 Sensei Profile",
  );

  const name = (
    await prompter.text({
      message: "Tên Sensei / Sensei's name",
      placeholder: "e.g. Minh",
      initialValue: "",
    })
  ).trim();

  const callAs = (
    await prompter.text({
      message: "Sensei muốn được gọi thế nào? / How should Arona call you?",
      placeholder: "e.g. Sensei, anh, chị, bạn",
      initialValue: name ? name : "Sensei",
    })
  ).trim();

  const location = (
    await prompter.text({
      message: "Vị trí / Location",
      placeholder: "e.g. Hồ Chí Minh, Việt Nam",
      initialValue: "",
    })
  ).trim();

  const birthday = (
    await prompter.text({
      message: "Ngày sinh / Birthday",
      placeholder: "e.g. 15/03",
      initialValue: "",
    })
  ).trim();

  const hobbies = (
    await prompter.text({
      message: "Sở thích / Hobbies",
      placeholder: "e.g. coding, anime, music",
      initialValue: "",
    })
  ).trim();

  const favoriteGames = (
    await prompter.text({
      message: "Game yêu thích / Favorite games",
      placeholder: "e.g. Blue Archive, Genshin Impact",
      initialValue: "",
    })
  ).trim();

  const notes = (
    await prompter.text({
      message: "Ghi chú thêm / Additional notes",
      placeholder: "Anything else Arona should know?",
      initialValue: "",
    })
  ).trim();

  return { name, callAs, location, birthday, hobbies, favoriteGames, notes };
}

/**
 * Build the USER.md content from a SenseiProfile.
 */
export function buildUserMdContent(profile: SenseiProfile): string {
  const lines = [
    "# USER.md - About Sensei",
    "",
    "_Arona's notes about Sensei. Updated during onboarding._",
    "",
    `- **Name:** ${profile.name || "_(not set)_"}`,
    `- **What to call them:** ${profile.callAs || "Sensei"}`,
    `- **Location:** ${profile.location || "_(not set)_"}`,
    `- **Birthday:** ${profile.birthday || "_(not set)_"}`,
    "",
    "## Interests",
    "",
    `- **Hobbies:** ${profile.hobbies || "_(not set)_"}`,
    `- **Favorite games:** ${profile.favoriteGames || "_(not set)_"}`,
    "",
    "## Context",
    "",
  ];

  if (profile.notes) {
    lines.push(profile.notes);
  } else {
    lines.push(
      "_(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)_",
    );
  }

  lines.push(
    "",
    "---",
    "",
    "The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.",
    "",
  );

  return lines.join("\n");
}

/**
 * Write the Sensei profile to USER.md in the workspace.
 */
export async function writeSenseiProfile(
  workspaceDir: string,
  profile: SenseiProfile,
): Promise<void> {
  const userMdPath = path.join(workspaceDir, "USER.md");
  const content = buildUserMdContent(profile);
  await fs.writeFile(userMdPath, content, "utf-8");
}

/**
 * Full onboarding step: prompt profile + write USER.md.
 * Shows a confirm prompt — defaults to No if USER.md already exists.
 */
export async function setupSenseiProfile(
  workspaceDir: string,
  prompter: WizardPrompter,
): Promise<void> {
  const userMdPath = path.join(workspaceDir, "USER.md");
  let exists = false;
  try {
    await fs.access(userMdPath);
    exists = true;
  } catch {
    // doesn't exist
  }

  const wantProfile = await prompter.confirm({
    message: exists
      ? "Update Sensei profile? (Cập nhật thông tin Sensei)"
      : "Set up Sensei profile? (Arona sẽ nhớ thông tin của bạn)",
    initialValue: !exists,
  });
  if (!wantProfile) {
    return;
  }

  const profile = await promptSenseiProfile(prompter);
  await writeSenseiProfile(workspaceDir, profile);
  await prompter.note(
    "Arona đã ghi nhớ thông tin của Sensei! ♪~\nArona has saved Sensei's profile!",
    "✅ Profile saved",
  );
}
