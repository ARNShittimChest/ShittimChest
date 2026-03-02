import { describe, expect, it } from "vitest";
import {
  analyzeTimeOfDay,
  analyzeKeywords,
  analyzeAbsence,
  analyzeInteraction,
  createEventTrigger,
} from "./mood-triggers.js";

// ── analyzeTimeOfDay ───────────────────────────────────────────────

describe("analyzeTimeOfDay", () => {
  it("returns sleepy trigger for late night (0-5)", () => {
    for (const hour of [0, 1, 2, 3, 4, 5]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.type).toBe("time");
      expect(trigger.source).toBe("late-night");
      expect(trigger.delta.sleepy).toBeGreaterThan(0);
    }
  });

  it("returns happy trigger for morning (6-8)", () => {
    for (const hour of [6, 7, 8]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.type).toBe("time");
      expect(trigger.source).toBe("morning");
      expect(trigger.delta.happy).toBeGreaterThan(0);
    }
  });

  it("returns happy+excited for mid-morning (9-11)", () => {
    for (const hour of [9, 10, 11]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.source).toBe("mid-morning");
      expect(trigger.delta.happy).toBeGreaterThan(0);
    }
  });

  it("returns happy+sleepy for lunch time (12-13)", () => {
    for (const hour of [12, 13]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.source).toBe("lunch-time");
    }
  });

  it("returns neutral for afternoon (14-17)", () => {
    for (const hour of [14, 15, 16, 17]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.source).toBe("afternoon");
    }
  });

  it("returns caring for evening (18-21)", () => {
    for (const hour of [18, 19, 20, 21]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.source).toBe("evening");
      expect(trigger.delta.caring).toBeGreaterThan(0);
    }
  });

  it("returns sleepy+caring for night (22-23)", () => {
    for (const hour of [22, 23]) {
      const trigger = analyzeTimeOfDay(hour);
      expect(trigger.source).toBe("night");
      expect(trigger.delta.sleepy).toBeGreaterThan(0);
    }
  });

  it("all time triggers have type 'time'", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(analyzeTimeOfDay(hour).type).toBe("time");
    }
  });
});

// ── analyzeKeywords ────────────────────────────────────────────────

describe("analyzeKeywords", () => {
  describe("positive/praise keywords", () => {
    it("detects Vietnamese 'cảm ơn'", () => {
      const trigger = analyzeKeywords("cảm ơn Arona nhé!");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.happy).toBeGreaterThan(0);
      expect(trigger!.source).toBe("khen-ngợi");
    });

    it("detects 'giỏi lắm'", () => {
      const trigger = analyzeKeywords("Arona giỏi lắm!");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.happy).toBeGreaterThan(0);
    });

    it("detects English 'thank'", () => {
      const trigger = analyzeKeywords("thank you!");
      expect(trigger).not.toBeNull();
      expect(trigger!.source).toBe("khen-ngợi");
    });

    it("detects 'good job'", () => {
      const trigger = analyzeKeywords("good job Arona");
      expect(trigger).not.toBeNull();
    });

    it("detects 'tuyệt vời'", () => {
      const trigger = analyzeKeywords("tuyệt vời!");
      expect(trigger).not.toBeNull();
    });
  });

  describe("negative/tired keywords", () => {
    it("detects 'mệt'", () => {
      const trigger = analyzeKeywords("mệt quá Arona ơi");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.caring).toBeGreaterThan(0);
      expect(trigger!.source).toBe("sensei-mệt");
    });

    it("detects 'buồn'", () => {
      const trigger = analyzeKeywords("hôm nay buồn quá");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.caring).toBeGreaterThan(0);
    });

    it("detects 'stress'", () => {
      const trigger = analyzeKeywords("stress quá @@");
      expect(trigger).not.toBeNull();
    });

    it("detects English 'tired'", () => {
      const trigger = analyzeKeywords("I'm so tired");
      expect(trigger).not.toBeNull();
      expect(trigger!.source).toBe("sensei-mệt");
    });

    it("detects 'đau'", () => {
      const trigger = analyzeKeywords("đau đầu quá");
      expect(trigger).not.toBeNull();
    });
  });

  describe("excitement keywords", () => {
    it("detects 'xong rồi'", () => {
      const trigger = analyzeKeywords("xong rồi!!!");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.excited).toBeGreaterThan(0);
      expect(trigger!.source).toBe("thành-công");
    });

    it("detects 'success'", () => {
      const trigger = analyzeKeywords("build success!");
      expect(trigger).not.toBeNull();
    });

    it("detects 'hoàn thành'", () => {
      const trigger = analyzeKeywords("đã hoàn thành task");
      expect(trigger).not.toBeNull();
    });
  });

  describe("error/bug keywords", () => {
    it("detects 'lỗi'", () => {
      const trigger = analyzeKeywords("bị lỗi rồi");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.worried).toBeGreaterThan(0);
      expect(trigger!.source).toBe("lỗi-phát-sinh");
    });

    it("detects 'bug'", () => {
      const trigger = analyzeKeywords("found a bug");
      expect(trigger).not.toBeNull();
    });

    it("detects 'crash'", () => {
      const trigger = analyzeKeywords("app crash rồi");
      expect(trigger).not.toBeNull();
    });
  });

  describe("strawberry milk ♡", () => {
    it("detects 'sữa dâu'", () => {
      const trigger = analyzeKeywords("cho Arona ly sữa dâu nè");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.happy).toBeGreaterThanOrEqual(0.6);
      expect(trigger!.source).toBe("sữa-dâu!");
    });

    it("detects 'strawberry milk'", () => {
      const trigger = analyzeKeywords("here's some strawberry milk");
      expect(trigger).not.toBeNull();
      expect(trigger!.source).toBe("sữa-dâu!");
    });

    it("detects 🍓 emoji", () => {
      const trigger = analyzeKeywords("🍓 cho Arona!");
      expect(trigger).not.toBeNull();
      expect(trigger!.source).toBe("sữa-dâu!");
    });
  });

  describe("joke/teasing keywords", () => {
    it("detects 'haha'", () => {
      const trigger = analyzeKeywords("haha lol");
      expect(trigger).not.toBeNull();
      expect(trigger!.delta.happy).toBeGreaterThan(0);
    });

    it("detects 😂 emoji", () => {
      const trigger = analyzeKeywords("omg 😂");
      expect(trigger).not.toBeNull();
    });
  });

  it("returns null for neutral text", () => {
    const trigger = analyzeKeywords("mở file config.ts");
    expect(trigger).toBeNull();
  });

  it("returns null for empty string", () => {
    const trigger = analyzeKeywords("");
    expect(trigger).toBeNull();
  });

  it("is case insensitive", () => {
    expect(analyzeKeywords("THANK YOU")).not.toBeNull();
    expect(analyzeKeywords("Good Job")).not.toBeNull();
    expect(analyzeKeywords("STRESS")).not.toBeNull();
  });
});

// ── analyzeAbsence ─────────────────────────────────────────────────

describe("analyzeAbsence", () => {
  const nowMs = Date.now();

  it("returns null for recent interaction (<2h)", () => {
    const oneHourAgo = nowMs - 1 * 60 * 60 * 1000;
    expect(analyzeAbsence(oneHourAgo, nowMs)).toBeNull();
  });

  it("returns null for very recent interaction (1 min)", () => {
    const oneMinAgo = nowMs - 60 * 1000;
    expect(analyzeAbsence(oneMinAgo, nowMs)).toBeNull();
  });

  it("returns mild sadness for 2-6h absence", () => {
    const threeHoursAgo = nowMs - 3 * 60 * 60 * 1000;
    const trigger = analyzeAbsence(threeHoursAgo, nowMs);
    expect(trigger).not.toBeNull();
    expect(trigger!.source).toBe("sensei-vắng-2h");
    expect(trigger!.delta.sad).toBe(0.2);
  });

  it("returns moderate sadness for 6-12h absence", () => {
    const eightHoursAgo = nowMs - 8 * 60 * 60 * 1000;
    const trigger = analyzeAbsence(eightHoursAgo, nowMs);
    expect(trigger).not.toBeNull();
    expect(trigger!.source).toBe("sensei-vắng-6h");
    expect(trigger!.delta.sad).toBe(0.4);
  });

  it("returns strong sadness for >12h absence", () => {
    const twentyHoursAgo = nowMs - 20 * 60 * 60 * 1000;
    const trigger = analyzeAbsence(twentyHoursAgo, nowMs);
    expect(trigger).not.toBeNull();
    expect(trigger!.source).toBe("sensei-vắng-lâu");
    expect(trigger!.delta.sad).toBe(0.6);
  });

  it("at exact 2h boundary returns mild trigger", () => {
    const exactlyTwoHours = nowMs - 2 * 60 * 60 * 1000;
    const trigger = analyzeAbsence(exactlyTwoHours, nowMs);
    expect(trigger).not.toBeNull();
    expect(trigger!.source).toBe("sensei-vắng-2h");
  });

  it("all triggers have type 'absence'", () => {
    const times = [3, 8, 20].map((h) => nowMs - h * 60 * 60 * 1000);
    for (const t of times) {
      const trigger = analyzeAbsence(t, nowMs);
      expect(trigger!.type).toBe("absence");
    }
  });
});

// ── analyzeInteraction ─────────────────────────────────────────────

describe("analyzeInteraction", () => {
  it("returns a happy interaction trigger", () => {
    const trigger = analyzeInteraction();
    expect(trigger.type).toBe("interaction");
    expect(trigger.source).toBe("sensei-nói-chuyện");
    expect(trigger.delta.happy).toBe(0.3);
  });
});

// ── createEventTrigger ─────────────────────────────────────────────

describe("createEventTrigger", () => {
  it("creates event trigger with given source and delta", () => {
    const trigger = createEventTrigger("task-done", { excited: 0.5, happy: 0.3 });
    expect(trigger.type).toBe("event");
    expect(trigger.source).toBe("task-done");
    expect(trigger.delta.excited).toBe(0.5);
    expect(trigger.delta.happy).toBe(0.3);
  });

  it("handles empty delta", () => {
    const trigger = createEventTrigger("empty", {});
    expect(trigger.type).toBe("event");
    expect(Object.keys(trigger.delta)).toHaveLength(0);
  });
});
