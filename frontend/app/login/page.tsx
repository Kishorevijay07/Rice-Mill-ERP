"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError, waitForBackend } from "@/lib/api";
import { useLogin, useMe } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorNote, ServerWaking } from "@/components/ui/misc";

const schema = z.object({
  identifier: z.string().min(1, "Enter your username or email"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();
  const { data: me } = useMe();
  const [waking, setWaking] = useState(false);
  const [wakeFailed, setWakeFailed] = useState(false);

  useEffect(() => {
    if (me) router.replace("/invoices");
  }, [me, router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setWakeFailed(false);
    // Make sure the (possibly asleep) backend is awake before we send the login,
    // so it never hits a half-started service. Instant when already warm.
    setWaking(true);
    const ready = await waitForBackend();
    setWaking(false);
    if (!ready) {
      setWakeFailed(true);
      return;
    }
    login.mutate(values, { onSuccess: () => router.replace("/invoices") });
  }

  const busy = waking || login.isPending;
  const errorMessage = wakeFailed
    ? "Couldn't reach the server. Please check your connection and try again."
    : login.error instanceof ApiError
      ? login.error.message
      : login.isError
        ? "Unable to sign in. Please try again."
        : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            (RM)<sup>2</sup>
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </CardHeader>
        <CardContent>
          {busy ? (
            <ServerWaking />
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Field
                label="Username or email"
                error={errors.identifier?.message}
              >
                <Input
                  autoFocus
                  autoComplete="username"
                  {...register("identifier")}
                />
              </Field>
              <Field label="Password" error={errors.password?.message}>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...register("password")}
                />
              </Field>
              <ErrorNote message={errorMessage} />
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
