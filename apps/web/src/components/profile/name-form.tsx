'use client';

import { useActionState, useState } from 'react';
import {
  Button,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import { updateNameAction } from '@/app/actions/profile';

/**
 * The profile page's name form, bound to {@link updateNameAction} through
 * `useActionState` (D-12: fields go through actions, only bytes need a route).
 * On success the field re-renders on the value apps/api stored, which is the
 * trimmed and normalised form of what was submitted (AC-2); on failure the
 * API's refusal is shown verbatim and nothing typed is thrown away (AC-3).
 *
 * The hint below the field mirrors apps/api's rules rather than replacing
 * them: the field carries no client-side length cap, so an over-long name
 * reaches the API and comes back with the API's own refusal instead of being
 * silently truncated in the browser. An empty submission is allowed through
 * for the same reason — it is how a stored name is cleared (AC-4).
 * @param props - The name to start on.
 * @param props.name - The stored display name, or `null` when none is set.
 * @returns The rendered name form.
 */
export function NameForm({ name }: { name: string | null }) {
  const [state, formAction, isPending] = useActionState(
    updateNameAction,
    undefined,
  );

  // The field is controlled on purpose: React 19 resets an *uncontrolled*
  // field once a form action settles, which would throw away what was typed
  // every time apps/api refused it. Holding the value here keeps a refusal
  // free of retyping (AC-3), at the cost of syncing on a successful save.
  const [value, setValue] = useState(name ?? '');
  const [submittedValue, setSubmittedValue] = useState<string | null>(null);
  const storedName = state?.ok ? (state.name ?? '') : null;
  const [lastStoredName, setLastStoredName] = useState<string | null>(null);

  if (storedName !== null && storedName !== lastStoredName) {
    // A save came back: show the value apps/api actually stored, which is the
    // trimmed and normalised form of what was submitted (AC-2). Setting state
    // while rendering is React's own answer to deriving state from props —
    // it re-renders immediately, before anything is painted.
    setLastStoredName(storedName);
    setValue(storedName);
  }

  // The refusal is about the value that was submitted, so editing the field
  // withdraws it. Leaving the field marked invalid would have the browser's
  // own constraint check block every further submission, and the form would
  // be stuck on the refusal it just showed.
  const refusal = value === submittedValue ? state?.error : undefined;

  /**
   * Remembers what is being submitted, so the refusal it comes back with can
   * be dropped again the moment the field is edited, then hands the form on
   * to the action `useActionState` bound.
   * @param formData - The submitted form fields (`name`).
   */
  function submit(formData: FormData): void {
    setSubmittedValue(String(formData.get('name') ?? ''));
    formAction(formData);
  }

  return (
    <Form className="flex w-full flex-col gap-4" action={submit}>
      <TextField
        autoComplete="name"
        className="w-full"
        isInvalid={Boolean(refusal)}
        name="name"
      >
        <Label>Display name</Label>
        <Input
          onChange={(event) => setValue(event.target.value)}
          placeholder="How other people see you"
          value={value}
        />
        <Description>
          Up to 80 characters. Leave it empty to go back to your email address.
        </Description>
        {/* The refusal belongs to the field, not to the page: rendering it
            here is what ties it to the input through `aria-describedby`, so a
            screen reader announces why the save was refused (AC-3). */}
        <FieldError>{refusal}</FieldError>
      </TextField>

      <div className="flex items-center gap-3">
        <Button className="self-start" isPending={isPending} type="submit">
          Save
        </Button>
        {/* A save changes the field and the avatar mark and nothing else, so
            without this a screen reader is told nothing at all happened. It
            withdraws as soon as the field moves off the saved value, rather
            than claiming what is on screen is what is stored. */}
        <p aria-live="polite" className="text-sm text-muted" role="status">
          {state?.ok && value === storedName ? 'Name saved.' : ''}
        </p>
      </div>
    </Form>
  );
}
