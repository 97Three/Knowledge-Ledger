import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { DemoKnowledge } from "@/api/demo";

const STORAGE_KEY = "ledger-onboarding-v1";
const TOTAL_STEPS = 5;

interface PersistedState {
  completed: number[];
  dismissed: boolean;
  demo?: DemoKnowledge;
}

function loadState(): PersistedState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored) as Partial<PersistedState>;
      return {
        completed: Array.isArray(parsed.completed) ? parsed.completed : [],
        dismissed: parsed.dismissed === true,
        ...(parsed.demo === undefined ? {} : { demo: parsed.demo }),
      };
    }
  } catch {
    // 隐私模式可能禁用存储；引导仍可只在内存里工作。
  }
  return { completed: [], dismissed: false };
}

export const useOnboardingStore = defineStore("onboarding", () => {
  const initial = loadState();
  const completed = ref<number[]>(initial.completed);
  const dismissed = ref(initial.dismissed);
  const demo = ref<DemoKnowledge | undefined>(initial.demo);
  const isOpen = ref(!initial.dismissed);

  const progress = computed(() => Math.round((completed.value.length / TOTAL_STEPS) * 100));
  const allDone = computed(() => completed.value.length >= TOTAL_STEPS);

  watch(
    [completed, dismissed, demo],
    () => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            completed: completed.value,
            dismissed: dismissed.value,
            ...(demo.value === undefined ? {} : { demo: demo.value }),
          }),
        );
      } catch {
        // 没有持久化也能继续用。
      }
    },
    { deep: true },
  );

  function completeStep(step: number): void {
    if (completed.value.includes(step)) return;
    if (step > 0 && !completed.value.includes(step - 1)) return;
    completed.value = [...completed.value, step].sort((left, right) => left - right);
  }

  function finish(): void {
    completed.value = [0, 1, 2, 3, 4];
    dismissed.value = true;
    isOpen.value = false;
  }

  function dismiss(): void {
    dismissed.value = true;
    isOpen.value = false;
  }

  function open(): void {
    isOpen.value = true;
  }

  function setOpen(value: boolean): void {
    isOpen.value = value;
  }

  function reset(): void {
    completed.value = [];
    dismissed.value = false;
    demo.value = undefined;
    isOpen.value = true;
  }

  function setDemo(value: DemoKnowledge): void {
    demo.value = value;
  }

  return {
    allDone,
    completed,
    demo,
    dismissed,
    finish,
    isOpen,
    open,
    progress,
    reset,
    setDemo,
    setOpen,
    completeStep,
    dismiss,
    totalSteps: TOTAL_STEPS,
  };
});
