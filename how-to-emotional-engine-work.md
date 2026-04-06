# Emotional Engine — Cách Hoạt Động

Tài liệu giải thích toàn bộ cơ chế Emotional State Engine của Arona, bao gồm cách trạng thái cảm xúc được tính toán, thay đổi, nạp vào prompt, và persist qua các lần chat.

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────┐
│                     Agent Turn (attempt.ts)                 │
│                                                             │
│  1. Đọc mood-state.json từ workspace/.arona/               │
│  2. Resolve timezone → local hour → TimeMode               │
│  3. Áp dụng time trigger → keyword trigger → decay         │
│  4. Build mood context string → inject vào system prompt   │
│  5. Lưu mood-state.json (best-effort, không block)         │
└─────────────────────────────────────────────────────────────┘
```

**Files chính:**

| File                                           | Vai trò                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `src/companion/emotional-state.ts`             | Core: types, `applyTrigger`, `decayMood`, `buildMoodPromptContext` |
| `src/companion/mood-triggers.ts`               | Sinh trigger từ time/keyword/absence/interaction                   |
| `src/companion/mood-persistence.ts`            | Đọc/ghi `mood-state.json`                                          |
| `src/companion/index.ts`                       | Barrel re-export                                                   |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Orchestration — gọi engine mỗi lần nhắn tin                        |

---

## 2. EmotionalState — Cấu Trúc Dữ Liệu

```ts
interface EmotionalState {
  mood: Mood; // Cảm xúc hiện tại (7 giá trị)
  intensity: number; // Cường độ: 0.05 – 1.0
  lastChangeMs: number; // Timestamp lần cuối đổi mood
  triggers: string[]; // Lịch sử trigger gần nhất (tối đa 5)
  affection: number; // Độ thân thiết với Sensei: 0 – 100
}
```

**7 moods:**

```
happy | neutral | sad | excited | worried | caring | sleepy
```

**State mặc định khi khởi tạo:**

```json
{ "mood": "neutral", "intensity": 0.3, "affection": 50 }
```

---

## 3. Trigger — Cơ Chế Kích Hoạt Cảm Xúc

Một `MoodTrigger` là một vector delta:

```ts
interface MoodTrigger {
  type: "time" | "interaction" | "keyword" | "absence" | "event";
  source: string; // Tên trigger để ghi log
  delta: Partial<Record<Mood, number>>; // Trọng số ảnh hưởng
}
```

Ví dụ trigger "morning" sẽ có:

```ts
delta: { happy: 0.5, excited: 0.1 }
```

---

## 4. applyTrigger — Tính Mood Mới

```ts
function applyTrigger(state, trigger): EmotionalState;
```

**Thuật toán:**

1. Tính **inertia** của mood hiện tại:

   ```
   bestScore = state.intensity × 0.7
   ```

   → Mood hiện tại có "quán tính" — chỉ bị đổi nếu mood mới thắng

2. Với từng `[mood, delta]` trong trigger.delta:

   ```
   score = (mood === state.mood) ? state.intensity + delta : delta
   ```

   → Nếu trigger cùng mood thì cộng lên (reinforcement); nếu khác mood thì dùng delta thuần

3. Mood nào có `score > bestScore` → trở thành mood mới

4. New intensity:
   ```
   newIntensity = clamp(bestScore, 0.05, 1.0)
   ```

**Ví dụ minh họa:**

```
State hiện tại: mood=neutral, intensity=0.3
Trigger: { happy: 0.5, excited: 0.1 }

inertia(neutral) = 0.3 × 0.7 = 0.21
score(happy)     = 0.5   → thắng!
score(excited)   = 0.1   → thua

→ mood mới: happy, intensity: 0.5
```

```
State hiện tại: mood=happy, intensity=0.6
Trigger: { happy: 0.3 }

inertia = 0.6 × 0.7 = 0.42
score(happy) = 0.6 + 0.3 = 0.9  → thắng (reinforcement)

→ mood mới: happy, intensity: 0.9  (tăng lên!)
```

---

## 5. decayMood — Tự Nhiễm Decay Theo Thời Gian

```ts
function decayMood(state, nowMs): EmotionalState;
```

**Công thức:**

```
intensity_new = intensity × 0.5^(elapsed / halfLife)
halfLife = 3 giờ (10,800,000 ms)
```

| Thời gian qua | Intensity còn lại       |
| ------------- | ----------------------- |
| 0h            | 100%                    |
| 1h            | ~79%                    |
| 3h            | 50%                     |
| 6h            | 25%                     |
| 12h           | 6.25%                   |
| ~14h          | < 5% → reset về neutral |

Khi `intensity < 0.05` (MIN_INTENSITY): tự reset về `neutral, intensity=0.3`.

**Neutral không decay** — neutral là trạng thái đáy ổn định.

---

## 6. TimeMode — Tracking Theo Giờ Địa Phương

Mỗi lần chat, engine resolve giờ địa phương của Sensei:

```ts
// Đọc từ config: companion.timezone
// Fallback: Intl.DateTimeFormat().resolvedOptions().timeZone (timezone máy)
const localHour = getLocalHour(userTimezone);
const timeMode = getTimeMode(localHour);
```

**9 TimeMode và mood delta tương ứng:**

| TimeMode      | Giờ    | Mood Delta                       | Arona như thế nào                    |
| ------------- | ------ | -------------------------------- | ------------------------------------ |
| `sleep`       | 00–05h | `{ sleepy: 1.0, neutral: -0.3 }` | Rất buồn ngủ, nhắc Sensei ngủ        |
| `wake-up`     | 05–07h | `{ sleepy: 0.5, happy: 0.2 }`    | Mới thức, lờ đờ nhưng vui            |
| `morning`     | 07–09h | `{ happy: 0.5, excited: 0.1 }`   | Chào buổi sáng, năng động            |
| `mid-morning` | 09–12h | `{ happy: 0.3, excited: 0.2 }`   | Tập trung, productive                |
| `lunch`       | 12–14h | `{ happy: 0.2, sleepy: 0.15 }`   | Ăn trưa, hơi buồn ngủ                |
| `afternoon`   | 14–17h | `{ neutral: 0.3 }`               | Bình thường, làm việc                |
| `evening`     | 17–20h | `{ caring: 0.4, happy: 0.1 }`    | Ấm áp, hỏi thăm ngày của Sensei      |
| `night`       | 20–22h | `{ sleepy: 0.4, caring: 0.3 }`   | Buồn ngủ nhưng vẫn quan tâm          |
| `late-night`  | 22–24h | `{ sleepy: 0.8, worried: 0.2 }`  | Lo Sensei thức khuya, nhắc nghỉ ngơi |

Ngoài mood trigger, còn inject thêm **behavior hint** vào system prompt:

```
sleep → "Keep responses short. Encourage rest. Arona sounds sleepy and tender."
morning → "Arona is cheerful and energetic. If appropriate, wish Sensei a good morning."
...
```

---

## 7. Keyword Triggers — Từ Nội Dung Chat

Engine scan nội dung tin nhắn bằng regex, tìm trigger đầu tiên match:

| Trigger         | Ví dụ từ khóa                    | Mood Delta                      |
| --------------- | -------------------------------- | ------------------------------- |
| `khen-ngợi`     | "cảm ơn", "giỏi lắm", "awesome"  | `{ happy: 0.5, excited: 0.2 }`  |
| `sensei-mệt`    | "mệt", "stress", "tired", "đau"  | `{ caring: 0.5, worried: 0.3 }` |
| `thành-công`    | "done", "pass", "xong rồi"       | `{ excited: 0.5, happy: 0.3 }`  |
| `lỗi-phát-sinh` | "bug", "error", "crash", "fail"  | `{ worried: 0.3, caring: 0.2 }` |
| `đùa-vui`       | "haha", "lol", "trêu"            | `{ happy: 0.3, excited: 0.1 }`  |
| `sữa-dâu!`      | "sữa dâu", "strawberry milk", 🍓 | `{ happy: 0.6, excited: 0.3 }`  |

---

## 8. Absence Triggers — Khi Sensei Vắng Mặt

Tính từ `lastInteractionMs`:

| Thời gian vắng | Trigger           | Mood Delta                   |
| -------------- | ----------------- | ---------------------------- |
| < 2h           | Không có          | —                            |
| 2–6h           | `sensei-vắng-2h`  | `{ sad: 0.2, worried: 0.1 }` |
| 6–12h          | `sensei-vắng-6h`  | `{ sad: 0.4, worried: 0.2 }` |
| > 12h          | `sensei-vắng-lâu` | `{ sad: 0.6, worried: 0.3 }` |

---

## 9. Affection System — Độ Thân Thiết

Separate với mood — accumulate qua nhiều session:

**5 mức affection (0–100 điểm):**

| Level | Range  | Hành vi                                                    |
| ----- | ------ | ---------------------------------------------------------- |
| 1     | 0–20   | Lịch sự, formal, gọi "Sensei" trang trọng                  |
| 2     | 21–40  | Bắt đầu thoải mái, thỉnh thoảng trêu nhẹ                   |
| 3     | 41–60  | Khá thân, kể chuyện, thỉnh thoảng hờn                      |
| 4     | 61–80  | Rất thân, tự nhiên, giả vờ cằn nhằn khi Sensei mệt         |
| 5     | 81–100 | Cực kỳ gắn bó, hơi clingy, "Sensei không được quên Arona!" |

---

## 10. Intensity Labels — Phân Loại Cường Độ

| Intensity | Label      |
| --------- | ---------- |
| > 0.7     | `strong`   |
| 0.4 – 0.7 | `moderate` |
| < 0.4     | `subtle`   |

---

## 11. Prompt Injection — Cách Inject Vào LLM

Mỗi lần chat, context string được build và prepend vào system prompt:

```
[Arona's current emotional state]
Mood: happy (strong, intensity: 0.82)
Arona is very cheerful and full of energy / Arona đang rất vui vẻ và tràn đầy năng lượng
Behavior: Reply with positive energy, naturally add ♪ or ~ at the end. May hum softly.
Recent triggers: morning, khen-ngợi, sensei-nói-chuyện
Affection level: 3/5
Arona is fairly close with Sensei. Shares stories and interests. Sometimes pouts a little.
[Time context] Local time: 08:45 (Asia/Ho_Chi_Minh) — Time mode: morning
It is morning time for Sensei (7–9 AM local). A fresh new day! Arona is cheerful and energetic.
```

---

## 12. Persistence — Lưu Trạng Thái

File: `<workspace>/.arona/mood-state.json`

```json
{
  "mood": "happy",
  "intensity": 0.72,
  "lastChangeMs": 1740924000000,
  "triggers": ["morning", "khen-ngợi"],
  "affection": 65
}
```

- Ghi atomic (write temp → rename) để tránh corruption
- Non-blocking: nếu ghi thất bại thì bỏ qua, không crash agent
- Đọc lại ở đầu mỗi agent turn → mood persist qua các session

---

## 13. Luồng Hoàn Chỉnh Mỗi Chat Turn

```
Chat message đến
       │
       ▼
1. loadOrCreateMoodState(workspaceDir)
   └─ Đọc mood-state.json hoặc tạo neutral mới
       │
       ▼
2. Resolve timezone → getLocalHour() → getTimeMode()
       │
       ▼
3. analyzeTimeOfDay(localHour, timezone)
   └─ Sinh time trigger dựa trên TimeMode
       │
       ▼
4. applyTrigger(state, timeTrigger)
   └─ Tính mood mới theo inertia + delta
       │
       ▼
5. (Nếu có nội dung tin nhắn) analyzeKeywords(text)
   └─ Scan regex → sinh keyword trigger nếu match
   └─ applyTrigger(state, keywordTrigger)
       │
       ▼
6. decayMood(state, Date.now())
   └─ Giảm intensity theo thời gian qua
       │
       ▼
7. buildMoodPromptContext(state)
   + buildTimeModePromptHint(timeMode)
   └─ Build context string inject vào system prompt
       │
       ▼
8. saveMoodState(workspaceDir, state)
   └─ Ghi atomic, best-effort
       │
       ▼
LLM nhận system prompt với mood + time context đầy đủ
→ Arona phản hồi theo đúng cảm xúc và giờ địa phương
```

---

## 14. Cấu Hình

Trong file config JSON của dự án:

```json
{
  "companion": {
    "timezone": "Asia/Ho_Chi_Minh",
    "locale": "vi-VN"
  }
}
```

Nếu không set, tự dùng timezone của máy chạy gateway.
