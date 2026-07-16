import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";

export interface AsyncResource<T> {
  readonly data: ShallowRef<T | undefined>;
  readonly error: Ref<Error | undefined>;
  readonly loading: Ref<boolean>;
  readonly refresh: () => Promise<void>;
}

/**
 * 与旧版 useAsyncResource 行为一致：进入即加载，依赖变化重新加载，
 * refresh 可手动触发；错误统一转成 Error 实例。
 */
export function useAsyncResource<T>(
  loader: () => Promise<T>,
  dependencies: () => readonly unknown[] = () => [],
): AsyncResource<T> {
  const data = shallowRef<T | undefined>(undefined);
  const error = ref<Error | undefined>(undefined);
  const loading = ref(true);

  const refresh = async (): Promise<void> => {
    loading.value = true;
    error.value = undefined;
    try {
      data.value = await loader();
    } catch (caught) {
      error.value = caught instanceof Error ? caught : new Error("未知错误");
    } finally {
      loading.value = false;
    }
  };

  watch(
    () => [...dependencies()],
    () => {
      void refresh();
    },
    { immediate: true },
  );

  return { data, error, loading, refresh };
}
