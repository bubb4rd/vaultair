import { useCallback, useEffect, useRef, useState } from "react";
import {
  generator,
  toIpcError,
  type Generated,
  type IpcError,
  type PassphraseOptions,
  type PasswordOptions,
} from "@/ipc/client";

export type GeneratorMode = "password" | "passphrase";

export interface GeneratorSettings {
  mode: GeneratorMode;
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

/** Mirrors the Rust bounds (`vaultair_core::generator`); Rust still validates. */
export const LIMITS = {
  length: { min: 8, max: 128 },
  words: { min: 3, max: 12 },
} as const;

export const DEFAULT_SETTINGS: GeneratorSettings = {
  mode: "password",
  password: {
    length: 20,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
    exclude: "",
  },
  passphrase: { words: 5, separator: "-", capitalize: false, includeNumber: false },
};

/**
 * Last-used settings, shared by the page and the popover. Memory only: a lock
 * reloads the webview and resets them. Saved preferences come with Settings
 * (Phase 15).
 */
let remembered = DEFAULT_SETTINGS;

/** For tests. */
export function resetGeneratorSettings() {
  remembered = DEFAULT_SETTINGS;
}

export function generatorErrorMessage(error: IpcError): string {
  if (error.code === "invalid_input" && error.field === "exclude") {
    return "That leaves a selected character type with nothing to use. Allow some of those characters or turn the type off.";
  }
  return error.message;
}

/**
 * Generates in Rust whenever the settings change, and on `regenerate`. Only
 * the newest request's answer is shown, so fast slider moves can't leave an
 * older value on screen.
 */
export function useGenerator() {
  const [settings, setSettings] = useState(remembered);
  const [result, setResult] = useState<Generated | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  const [round, setRound] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    remembered = settings;
  }, [settings]);

  useEffect(() => {
    const request = ++latest.current;
    const run =
      settings.mode === "password" ? generator.password(settings.password) : generator.passphrase(settings.passphrase);
    run
      .then((generated) => {
        if (request !== latest.current) return;
        setResult(generated);
        setError(null);
      })
      .catch((err: unknown) => {
        if (request !== latest.current) return;
        // Clear the old value so Copy can't hand out one that breaks the new rules.
        setResult(null);
        setError(toIpcError(err));
      });
  }, [settings, round]);

  const setMode = useCallback((mode: GeneratorMode) => {
    setSettings((s) => ({ ...s, mode }));
  }, []);
  const setPassword = useCallback((patch: Partial<PasswordOptions>) => {
    setSettings((s) => ({ ...s, password: { ...s.password, ...patch } }));
  }, []);
  const setPassphrase = useCallback((patch: Partial<PassphraseOptions>) => {
    setSettings((s) => ({ ...s, passphrase: { ...s.passphrase, ...patch } }));
  }, []);
  const regenerate = useCallback(() => {
    setRound((r) => r + 1);
  }, []);

  return { settings, result, error, setMode, setPassword, setPassphrase, regenerate };
}

export type Generator = ReturnType<typeof useGenerator>;
