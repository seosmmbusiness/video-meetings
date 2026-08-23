'use client';

import { useActionState, useState } from 'react';
import {
  Button,
  Description,
  Form,
  Input,
  Label,
  TextField,
} from '@heroui/react';
import {
  changePasswordAction,
  type ChangePasswordState,
} from '@/app/actions/profile';

/** The three fields the form submits, as typed. */
interface PasswordFields {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_FIELDS: PasswordFields = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/**
 * The profile page's password form, bound to {@link changePasswordAction}
 * through `useActionState` (D-12: fields go through actions, only bytes need a
 * route). It submits and renders — every decision about whether the change is
 * allowed is made server-side, including the confirmation match, so the gate
 * holds however the action is reached rather than only through this form
 * (AC-12) and apps/api's own refusal is what reaches the screen (AC-11).
 *
 * For the same reason the new-password field carries no `pattern` and no
 * length cap: a client-side rule would swallow the value before apps/api ever
 * saw it, and the refusal naming the broken rule would never be rendered. The
 * hint below it mirrors those rules rather than enforcing them.
 * @returns The rendered password form.
 */
export function PasswordForm() {
  const [state, formAction, isPending] = useActionState(
    changePasswordAction,
    undefined,
  );

  // The fields are controlled on purpose: React 19 resets an *uncontrolled*
  // field once a form action settles, which would cost a full retype every
  // time apps/api refused the change. Holding the values here is also what
  // lets a success empty all three, so neither password lingers in the page.
  const [fields, setFields] = useState<PasswordFields>(EMPTY_FIELDS);
  const [clearedFor, setClearedFor] = useState<ChangePasswordState | undefined>(
    undefined,
  );

  if (state?.ok && state !== clearedFor) {
    // The change landed: setting state while rendering is React's own answer
    // to deriving state from a prop, and re-renders before anything is painted.
    setClearedFor(state);
    setFields(EMPTY_FIELDS);
  }

  // The refusal is about the values that were submitted, so editing any field
  // withdraws it rather than leaving a stale message under a form that has
  // since changed.
  const [isEdited, setIsEdited] = useState(false);
  const refusal = isEdited ? undefined : state?.error;
  const isChanged = Boolean(state?.ok) && state === clearedFor;

  /**
   * Updates one field and withdraws the refusal the previous submission came
   * back with.
   * @param field - The field being typed into.
   * @returns A change handler for that field's input.
   */
  function edit(field: keyof PasswordFields) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setIsEdited(true);
      setFields((previous) => ({ ...previous, [field]: value }));
    };
  }

  /**
   * Marks the fields as submitted — so the outcome that comes back is shown
   * against them — then hands the form on to the action `useActionState` bound.
   * @param formData - The submitted fields.
   */
  function submit(formData: FormData): void {
    setIsEdited(false);
    formAction(formData);
  }

  return (
    <Form className="flex w-full flex-col gap-4" action={submit}>
      <TextField
        autoComplete="current-password"
        className="w-full"
        name="currentPassword"
        type="password"
      >
        <Label>Current password</Label>
        <Input
          onChange={edit('currentPassword')}
          placeholder="The password you sign in with today"
          value={fields.currentPassword}
        />
      </TextField>

      <TextField
        autoComplete="new-password"
        className="w-full"
        name="newPassword"
        type="password"
      >
        <Label>New password</Label>
        <Input
          onChange={edit('newPassword')}
          placeholder="The password you want instead"
          value={fields.newPassword}
        />
        <Description>
          At least 8 characters and at most 72, with an uppercase letter, a
          lowercase letter and a digit.
        </Description>
      </TextField>

      <TextField
        autoComplete="new-password"
        className="w-full"
        name="confirmPassword"
        type="password"
      >
        <Label>Confirm new password</Label>
        <Input
          onChange={edit('confirmPassword')}
          placeholder="The new password once more"
          value={fields.confirmPassword}
        />
      </TextField>

      {/* The refusal belongs to the form rather than to one field: apps/api
          answers a wrong current password, a broken rule and a mismatched
          confirmation through the same channel, and pinning all three to one
          input would point at the wrong field as often as at the right one.
          `role="alert"` is what makes it heard — it lands while focus is still
          on the button. */}
      <div role="alert">
        {refusal ? <p className="text-sm text-danger">{refusal}</p> : null}
      </div>

      <div className="flex items-center gap-3">
        <Button className="self-start" isPending={isPending} type="submit">
          Change password
        </Button>
        {/* Nothing else on the page moves when a password changes, so without
            this a screen reader is told nothing happened at all (AC-10). */}
        <p aria-live="polite" className="text-sm text-muted" role="status">
          {isChanged ? 'Password changed.' : ''}
        </p>
      </div>
    </Form>
  );
}
