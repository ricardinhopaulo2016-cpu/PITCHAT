"use client";

import * as Switch from "@radix-ui/react-switch";
import { useSyncExternalStore } from "react";
import {
  getSoundPreferenceServerSnapshot,
  isSoundEnabled,
  setSoundEnabled,
  subscribeSoundPreference,
} from "@/lib/sound";

/** Toggle de som — default OFF, opt-in explícito (docs/PITCHAT_DESIGN_SYSTEM.md §9). */
export function SoundToggle() {
  // useSyncExternalStore é o jeito correto de ler estado externo
  // (localStorage) sem hydration mismatch nem setState síncrono em effect.
  const enabled = useSyncExternalStore(subscribeSoundPreference, isSoundEnabled, getSoundPreferenceServerSnapshot);

  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 text-sm text-text">
      <span>Sons</span>
      <Switch.Root
        checked={enabled}
        onCheckedChange={setSoundEnabled}
        className="relative h-[18px] w-8 shrink-0 rounded-full bg-surface-3 outline-none transition-colors duration-[var(--motion-ui)] data-[state=checked]:bg-signal"
      >
        <Switch.Thumb className="block h-3.5 w-3.5 translate-x-[2px] rounded-full bg-text-secondary transition-transform duration-[var(--motion-ui)] data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-signal-on" />
      </Switch.Root>
    </div>
  );
}
