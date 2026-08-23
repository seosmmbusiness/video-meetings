import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePasswordAction } from '@/app/actions/profile';
import { PasswordForm } from './password-form';

vi.mock('@/app/actions/profile', () => ({ changePasswordAction: vi.fn() }));

const action = vi.mocked(changePasswordAction);

const CURRENT_PASSWORD = 'Str0ngPass!';
const NEW_PASSWORD = 'N3wStrongPass';

// apps/api's own wording for a wrong current password
// (`profile.service.ts`), which is what has to reach the screen (AC-11).
const WRONG_CURRENT_PASSWORD = 'Current password is incorrect.';

/**
 * Reads a field out of the FormData the action was last called with.
 * @param field - The form field's name.
 * @returns The submitted value.
 */
function submitted(field: string): string {
  const formData = action.mock.calls.at(-1)?.[1] as FormData;
  return String(formData.get(field));
}

/**
 * Fills the three fields and submits, which is the only way to reach the
 * action — the confirmation gate lives behind it, not in front of it.
 * @param fields - The values to type; each defaults to a valid one.
 * @param fields.currentPassword - The current password as typed.
 * @param fields.newPassword - The new password as typed.
 * @param fields.confirmPassword - The new password as re-typed.
 */
async function changePassword(
  fields: {
    currentPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  } = {},
): Promise<void> {
  const newPassword = fields.newPassword ?? NEW_PASSWORD;
  await userEvent.type(
    screen.getByLabelText('Current password'),
    fields.currentPassword ?? CURRENT_PASSWORD,
  );
  await userEvent.type(screen.getByLabelText('New password'), newPassword);
  await userEvent.type(
    screen.getByLabelText('Confirm new password'),
    fields.confirmPassword ?? newPassword,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Change password' }),
  );
}

describe('PasswordForm', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('starts empty — a password form has nothing stored to show', () => {
    render(<PasswordForm />);

    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('submits all three typed values through the Server Action', async () => {
    action.mockResolvedValue({ ok: true });
    render(<PasswordForm />);

    await changePassword();

    expect(action).toHaveBeenCalledTimes(1);
    expect(submitted('currentPassword')).toBe(CURRENT_PASSWORD);
    expect(submitted('newPassword')).toBe(NEW_PASSWORD);
    expect(submitted('confirmPassword')).toBe(NEW_PASSWORD);
  });

  it('leaves the confirmation check to the action rather than blocking it here (AC-12)', async () => {
    action.mockResolvedValue({
      ok: false,
      error: 'New password and its confirmation do not match.',
    });
    render(<PasswordForm />);

    await changePassword({ confirmPassword: `${NEW_PASSWORD}x` });

    // The gate has to run server-side to hold with JavaScript disabled, so the
    // form's job is to submit and render what comes back — not to decide.
    expect(action).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(
        'New password and its confirmation do not match.',
      ),
    ).toBeInTheDocument();
  });

  it("shows apps/api's own refusal verbatim (AC-11)", async () => {
    action.mockResolvedValue({ ok: false, error: WRONG_CURRENT_PASSWORD });
    render(<PasswordForm />);

    await changePassword({ currentPassword: 'WrongPass1' });

    expect(await screen.findByText(WRONG_CURRENT_PASSWORD)).toBeInTheDocument();
  });

  it('announces the refusal instead of only painting the field (AC-11)', async () => {
    action.mockResolvedValue({ ok: false, error: WRONG_CURRENT_PASSWORD });
    render(<PasswordForm />);

    await changePassword({ currentPassword: 'WrongPass1' });

    // The refusal arrives while focus is still on the submit button, so
    // nothing tied to the field alone would be read out.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      WRONG_CURRENT_PASSWORD,
    );
  });

  it('keeps the new password that was typed when the change is refused, so a refusal costs no retyping', async () => {
    action.mockResolvedValue({ ok: false, error: WRONG_CURRENT_PASSWORD });
    render(<PasswordForm />);

    await changePassword({ currentPassword: 'WrongPass1' });

    expect(await screen.findByText(WRONG_CURRENT_PASSWORD)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue(NEW_PASSWORD);
  });

  it('confirms a successful change, since nothing else on the page moves (AC-10)', async () => {
    action.mockResolvedValue({ ok: true });
    render(<PasswordForm />);

    await changePassword();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed.',
    );
  });

  it('empties the fields once the change lands, so neither password lingers in the page', async () => {
    action.mockResolvedValue({ ok: true });
    render(<PasswordForm />);

    await changePassword();

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Password changed.',
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('masks every field and describes it in words rather than in bullet characters', () => {
    render(<PasswordForm />);

    for (const label of [
      'Current password',
      'New password',
      'Confirm new password',
    ]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('type', 'password');

      // A placeholder of bullets says nothing a masked field doesn't already
      // show, and is read out character by character by a screen reader.
      const placeholder = field.getAttribute('placeholder') ?? '';
      expect(placeholder).not.toMatch(/[•*·]/);
    }
  });

  it("states the API's password rules without enforcing them in place of the API (AC-12)", () => {
    render(<PasswordForm />);

    expect(screen.getByText(/8 characters/)).toBeInTheDocument();

    // A client-side rule would swallow the value before apps/api ever saw it,
    // and the refusal naming the broken rule would never be rendered.
    expect(screen.getByLabelText('New password')).not.toHaveAttribute(
      'pattern',
    );
  });
});
