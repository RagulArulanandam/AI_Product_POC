"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function initialsOf(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._\-+\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return (letters || "?").toUpperCase();
}

export function UserMenu({ email, role }: { email: string; role: string }) {
  const form = useRef<HTMLFormElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Account menu"
      >
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initialsOf(email)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-[10rem] truncate font-medium sm:block">{email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate text-sm font-medium">{email}</p>
          <p className="text-xs font-normal capitalize text-muted-foreground">{role}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* A real form keeps logout a server action; the menu item just submits it. */}
        <form ref={form} action={logoutAction} className="hidden" />
        <DropdownMenuItem className="cursor-pointer py-2" onClick={() => form.current?.requestSubmit()}>
          <LogOut className="size-4" aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
