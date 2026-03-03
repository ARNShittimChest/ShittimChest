# AI-Based Affection Analysis — Cách Hoạt Động

Tính năng sử dụng một model AI nhẹ (lightweight LLM) để phân tích cảm xúc trong tin nhắn của Sensei. Thay vì dựa vào regex keyword matching, AI hiểu được ngữ cảnh, sarcasm, emoji, và nhiều ngôn ngữ. Nếu không cấu hình hoặc API fail → tự động fallback về regex.

---

## 1. Tổng Quan Luồng

```
Tin nhắn của Sensei
       │
       ▼
┌──────────────────────────────────┐
│ companion.affectionAnalysis      │
│ enabled: true?                   │
│ provider có trong models?        │
│ provider có apiKey?              │
└──────┬───────────────────────────┘
       │
  ┌────┴────┐
  │ YES     │ NO
  ▼         ▼
┌─────────┐ ┌──────────────────┐
│ Gọi API │ │ Regex Keyword    │
│ (fetch) │ │ Matching         │
│ 5s      │ │ (fallback)       │
│ timeout │ │                  │
└────┬────┘ └──────┬───────────┘
     │              │
     │  Fail?───────┘
     ▼
┌──────────────────────────────────┐
│ JSON response:                   │
│ { mood, intensity,               │
│   affectionDelta, reason }       │
└──────┬───────────────────────────┘
       ▼
  applyTrigger()      → mood thay đổi
  addAffectionPoints() → điểm hảo cảm ±
       ▼
  Lưu mood-state.json
```

---

## 2. Cấu Hình

**Điểm khác biệt chính:** Không cần API key riêng — dùng lại provider đã cấu hình sẵn trong `models.providers`.

```json
{
  "models": {
    "providers": {
      "google": {
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "api": "google-generative-ai",
        "apiKey": "${GEMINI_API_KEY}",
        "models": [...]
      }
    }
  },
  "companion": {
    "timezone": "Asia/Ho_Chi_Minh",
    "affectionAnalysis": {
      "enabled": true,
      "provider": "google",
      "model": "gemini-2.0-flash-lite"
    }
  }
}
```

### Các trường trong `companion.affectionAnalysis`

| Trường      | Bắt buộc | Mặc định                | Mô tả                                 |
| ----------- | -------- | ----------------------- | ------------------------------------- |
| `enabled`   | ✅       | `false`                 | Bật/tắt AI analysis                   |
| `provider`  | ✅       | —                       | Tên provider trong `models.providers` |
| `model`     | Không    | `gemini-2.0-flash-lite` | Model ID cho classification           |
| `timeoutMs` | Không    | `5000`                  | Timeout API call (ms)                 |

### Resolve Config Logic

```
resolveAnalysisConfig({
  affectionAnalysis,    ← từ companion config
  providers             ← từ models.providers
})
  1. enabled === false hoặc thiếu provider → return null (skip)
  2. Tìm provider trong models.providers[name]
  3. Không tìm thấy hoặc thiếu apiKey → return null (skip)
  4. Auto-detect API type:
     - provider.api === "google-generative-ai" → Google endpoint
     - Mọi thứ khác → OpenAI-compatible endpoint
  5. Kế thừa: baseUrl, apiKey từ provider config
  6. Return AffectionAnalysisConfig → sẵn sàng gọi API
```

---

## 3. Prompt Gửi Cho AI

### System Prompt (Classification Prompt)

```
You are a sentiment classifier for a companion AI system.
Analyze the user's message and classify its emotional intent.

Return ONLY a valid JSON object with these fields:
- "mood": one of "happy", "neutral", "sad", "excited", "worried", "caring", "sleepy"
- "intensity": number 0.0 to 1.0 (how strong is the emotion)
- "affectionDelta": integer -10 to +10 (how much this affects the relationship)
  - Positive: praise, thanks, gifts, compliments, jokes, caring → +1 to +6
  - Neutral: normal questions, technical talk, bugs → 0
  - Negative: rudeness, ignoring, broken promises, dismissal → -1 to -5
- "reason": short tag describing the trigger (e.g. "khen-ngợi", "thô-lỗ", "normal-chat")

Example outputs:
{"mood":"happy","intensity":0.6,"affectionDelta":3,"reason":"khen-ngợi"}
{"mood":"neutral","intensity":0.2,"affectionDelta":0,"reason":"technical-question"}
{"mood":"sad","intensity":0.4,"affectionDelta":-3,"reason":"bị-phạt-ngượt"}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation.
```

### Parameters Gửi Kèm

| Tham số         | Google API                             | OpenAI-compatible |
| --------------- | -------------------------------------- | ----------------- |
| temperature     | `0.1`                                  | `0.1`             |
| max tokens      | `200`                                  | `200`             |
| response format | `responseMimeType: "application/json"` | (không ép)        |

---

## 4. Đầu Ra (Output) Từ AI

### JSON Schema Kỳ Vọng

```typescript
interface AffectionAnalysisResult {
  mood: "happy" | "neutral" | "sad" | "excited" | "worried" | "caring" | "sleepy";
  intensity: number; // 0.0 – 1.0
  affectionDelta: number; // -10 to +10, integer
  reason: string; // short tag
}
```

### Ví Dụ Input → Output

| Tin nhắn Sensei                   | AI Output                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `"Cảm ơn Arona, giúp rất nhiều!"` | `{"mood":"happy","intensity":0.7,"affectionDelta":4,"reason":"khen-ngợi"}`         |
| `"fix cái bug này đi"`            | `{"mood":"neutral","intensity":0.2,"affectionDelta":0,"reason":"work-request"}`    |
| `"Arona dễ thương quá"`           | `{"mood":"happy","intensity":0.8,"affectionDelta":6,"reason":"khen-Arona"}`        |
| `"im đi, khó chịu quá"`           | `{"mood":"sad","intensity":0.5,"affectionDelta":-4,"reason":"bị-phạt"}`            |
| `"haha trêu chơi thôi"`           | `{"mood":"happy","intensity":0.4,"affectionDelta":2,"reason":"đùa-vui"}`           |
| `"mệt quá, stress nặng"`          | `{"mood":"caring","intensity":0.6,"affectionDelta":1,"reason":"sensei-mệt"}`       |
| `"💀"`                            | `{"mood":"neutral","intensity":0.3,"affectionDelta":-1,"reason":"emoji-negative"}` |
| `"Thanks but it didn't help"`     | `{"mood":"sad","intensity":0.3,"affectionDelta":-2,"reason":"disappointment"}`     |

### Validation Rules (Parse Response)

AI response được validate nghiêm ngặt:

1. Strip markdown code fences (nếu có): ` ```json ... ``` `
2. Parse JSON
3. `mood` phải nằm trong 7 giá trị hợp lệ
4. `intensity` phải là number trong [0.0, 1.0]
5. `affectionDelta` phải là integer trong [-10, +10]
6. `reason` phải là string (fallback: `"ai-analysis"`)
7. **Nếu bất kỳ field nào invalid → return null → fallback regex**

---

## 5. Cách Gọi API (Theo Provider Type)

### Google Generative AI (`api: "google-generative-ai"`)

```
POST {baseUrl}/models/{model}:generateContent?key={apiKey}

Body:
{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "{CLASSIFICATION_PROMPT}\n\nUser message:\n{userText}" }]
  }],
  "generationConfig": {
    "temperature": 0.1,
    "maxOutputTokens": 200,
    "responseMimeType": "application/json"
  }
}

Response path: data.candidates[0].content.parts[0].text
```

### OpenAI-Compatible (tất cả provider khác)

```
POST {baseUrl}/v1/chat/completions
Headers: Authorization: Bearer {apiKey}

Body:
{
  "model": "{model}",
  "messages": [
    { "role": "system", "content": "{CLASSIFICATION_PROMPT}" },
    { "role": "user", "content": "{userText}" }
  ],
  "temperature": 0.1,
  "max_tokens": 200
}

Response path: data.choices[0].message.content
```

---

## 6. Tích Hợp Vào Agent (attempt.ts)

Mỗi lượt chat (agent turn):

```
1. Lấy config: params.config.companion.affectionAnalysis
2. Lấy providers: params.config.models.providers

3. resolveAnalysisConfig({ affectionAnalysis, providers })
   → AffectionAnalysisConfig | null

4. Nếu có aiConfig:
   ├─ analyzeAffectionWithAI(params.prompt, aiConfig)
   ├─ Nếu thành công (usedAI = true):
   │   ├─ aiResultToMoodTrigger(result) → MoodTrigger
   │   │   └─ { type: "keyword", source: "ai:{reason}", delta: { {mood}: {intensity} } }
   │   ├─ applyTrigger(moodState, trigger)
   │   └─ addAffectionPoints(moodState, result.affectionDelta + 1, "ai:{reason}")
   │       └─ +1 là INTERACTION_AFFECTION_DELTA (bonus tương tác)
   └─ Nếu thất bại → usedAI = false

5. Nếu !usedAI (AI fail hoặc không configured):
   ├─ analyzeKeywords(prompt) → regex keyword matching
   ├─ analyzeAffectionDelta(prompt) → regex-based point delta
   └─ addAffectionPoints(moodState, delta + 1, "+N (chat)")

6. decayMood() → phân rã mood theo thời gian
7. saveMoodState() → lưu vào mood-state.json
8. Inject vào system prompt: mood context + affection level + time mode
```

---

## 7. Ví Dụ Cấu Hình Theo Provider

### Google AI Studio (Miễn phí)

```json
{
  "provider": "google",
  "model": "gemini-2.0-flash-lite"
}
```

### OpenAI

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

### Ollama (Local, miễn phí)

```json
{
  "provider": "ollama",
  "model": "qwen2.5:3b"
}
```

### DeepSeek

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat"
}
```

### Groq (Miễn phí)

```json
{
  "provider": "groq",
  "model": "llama-3.1-8b-instant"
}
```

> **Lưu ý:** Provider phải tồn tại trong `models.providers` (đã cấu hình sẵn API key + base URL).

---

## 8. So Sánh AI vs Regex

|                                 | Regex                  | AI                           |
| ------------------------------- | ---------------------- | ---------------------------- |
| `"Cảm ơn, nhưng chẳng giúp gì"` | ❌ +3 (match "cảm ơn") | ✅ -2 (detect sarcasm)       |
| `"I appreciate your help"`      | ❌ Không match         | ✅ +4 (hiểu tiếng Anh)       |
| `"💀"`                          | ❌ Không match         | ✅ -1 (detect emoji)         |
| `"mệt rồi, nghỉ thôi Arona"`    | ✅ +0 (match "mệt")    | ✅ +1 (hiểu context caring)  |
| `"fix bug"`                     | ❌ Không match         | ✅ 0 (neutral, work request) |
| Latency                         | 0ms                    | 200-2000ms                   |
| Cost                            | Free                   | Free~$0.03/tháng             |
| Accuracy                        | Pattern-based          | Context-aware                |

---

## 9. Đảm Bảo An Toàn

- **Non-blocking:** `AbortSignal.timeout(5000ms)` — không block agent
- **Best-effort:** Try-catch wrap toàn bộ — nếu API fail → fallback regex, không crash
- **Không gửi dữ liệu nhạy cảm:** Chỉ gửi nội dung tin nhắn cuối cùng (`params.prompt`)
- **API key an toàn:** Kế thừa từ provider config (hỗ trợ env var `${VAR}`)
- **Skip tin nhắn quá ngắn:** `userText.length < 2` → return null
- **Validation nghiêm ngặt:** Output phải pass tất cả validation rules, nếu không → null → regex

---

## 10. Files Liên Quan

| File                                  | Vai trò                                          |
| ------------------------------------- | ------------------------------------------------ |
| `src/companion/affection-analyzer.ts` | Core: API calls, prompt, parsing, resolve config |
| `src/companion/mood-triggers.ts`      | Regex fallback: keyword rules + affection deltas |
| `src/companion/emotional-state.ts`    | State machine: applyTrigger, addAffectionPoints  |
| `src/companion/index.ts`              | Barrel exports                                   |
| `src/config/types.shittimchest.ts`    | TypeScript type cho `affectionAnalysis`          |
| `src/config/zod-schema.ts`            | Zod validation schema cho `companion` key        |
| `src/commands/onboard-companion.ts`   | Onboarding wizard step                           |
| `src/agents/.../attempt.ts`           | Orchestration: resolve → AI → fallback → save    |

---

## 11. Onboarding

Khi chạy `npm start onboard`, sau bước Sensei Profile:

```
🧠 Companion — AI Emotional Analysis

? Enable AI-based emotional analysis? (Y/n)     → No = skip, dùng regex

? Filter models by provider                       → Chọn provider (google, openai, ollama...)
  ● google
  ○ openai
  ○ ollama
  ○ All providers

? Pick a lightweight model for emotional analysis  → Chọn model (same UI as main model picker)
  ● google/gemini-2.0-flash-lite
  ○ google/gemini-2.5-flash
  ○ Enter model manually
```

Kết quả ghi vào config:

```json
{
  "companion": {
    "affectionAnalysis": {
      "enabled": true,
      "provider": "google",
      "model": "gemini-2.0-flash-lite"
    }
  }
}
```
