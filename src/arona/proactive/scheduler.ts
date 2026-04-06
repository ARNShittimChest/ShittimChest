/**
 * arona/proactive/scheduler.ts
 * Sends proactive messages from Arona at scheduled times and random intervals.
 */

export type ProactiveEvent = {
  prompt: string;
};

export type ProactiveTrigger = (evt: ProactiveEvent) => void;

const PROMPTS = {
  morning:
    "[System] Bây giờ là 6h sáng. Hãy gửi lời chào buổi sáng thật dễ thương và khích lệ Sensei bằng giọng của Tiểu thư Arona. Viết ngắn gọn 1-2 câu thôi.",
  lunch:
    "[System] Bây giờ là 12h trưa. Hãy nhắc nhở thức ăn và nghỉ ngơi cho Sensei bằng giọng của Tiểu thư Arona. Viết ngắn gọn 1-2 câu thôi.",
  goodnight:
    "[System] Bây giờ là 10h khuya. Hãy chúc Sensei ngủ ngon và nhắc nhở không thức quá khuya bằng giọng của Arona. Viết ngắn gọn 1-2 câu thôi.",
  nudge:
    "[System] Sensei đang làm việc vắng mặt khá lâu, hãy nói một lời chào quan tâm đến Sensei bằng giọng của Arona. Viết ngắn gọn 1-2 câu thôi.",
};

function msUntilHour(hour: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

type Disposable = () => void;

function scheduleRepeating(
  hourOfDay: number,
  prompt: string,
  onTrigger: ProactiveTrigger,
): Disposable {
  let timer: ReturnType<typeof setTimeout>;
  function fire() {
    onTrigger({ prompt });
    const nextMs = msUntilHour(hourOfDay);
    timer = setTimeout(fire, nextMs);
  }
  timer = setTimeout(fire, msUntilHour(hourOfDay));
  return () => clearTimeout(timer);
}

function scheduleRandomNudge(onTrigger: ProactiveTrigger): Disposable {
  let timer: ReturnType<typeof setTimeout>;
  function fire() {
    const hour = new Date().getHours();
    // Only nudge during waking hours from 6 AM to 10 PM (6-22)
    if (hour >= 6 && hour <= 22) {
      onTrigger({ prompt: PROMPTS.nudge });
    }
    timer = setTimeout(fire, randomBetween(2.5 * 60 * 60_000, 5 * 60 * 60_000));
  }
  timer = setTimeout(fire, randomBetween(2 * 60 * 60_000, 4 * 60 * 60_000));
  return () => clearTimeout(timer);
}

export function startProactiveScheduler(onTrigger: ProactiveTrigger): Disposable {
  const stops = [
    scheduleRepeating(6, PROMPTS.morning, onTrigger),
    scheduleRepeating(12, PROMPTS.lunch, onTrigger),
    scheduleRepeating(22, PROMPTS.goodnight, onTrigger),
    scheduleRandomNudge(onTrigger),
  ];
  return () => stops.forEach((s) => s());
}
