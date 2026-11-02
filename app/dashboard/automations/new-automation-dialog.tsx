"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { CreateAutomationForm } from "./create-automation-form";

export function NewAutomationDialog({
  profiles,
  accounts,
}: {
  profiles: { id: string; name: string }[];
  accounts: { id: string; profile_id: string; username: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="primary">
          Nova automação
        </Button>
      </DialogTrigger>
      <DialogContent title="Nova automação" description="Escolha a conta e dê um nome. O fluxo você monta na tela seguinte.">
        <CreateAutomationForm profiles={profiles} accounts={accounts} />
      </DialogContent>
    </Dialog>
  );
}
