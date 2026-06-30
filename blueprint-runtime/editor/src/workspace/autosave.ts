/**
 * editor/src/workspace/autosave（防抖自动保存 · L-Workspace）。
 */

/** 自动保存控制器。 */
export interface Autosave {
  trigger(): void;
  cancel(): void;
}

/**
 * 创建防抖自动保存：多次 trigger 在 delayMs 内只触发一次 save。
 *
 * @param save 保存回调
 * @param delayMs 防抖延时（默认 500ms）
 * @returns Autosave
 */
export function createAutosave(save: () => void, delayMs = 500): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger: (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        save();
      }, delayMs);
    },
    cancel: (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
