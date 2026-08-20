import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateNameAction } from '@/app/actions/profile';
import { NameForm } from './name-form';

vi.mock('@/app/actions/profile', () => ({ updateNameAction: vi.fn() }));

const action = vi.mocked(updateNameAction);

/**
 * Reads the `name` field out of the FormData the action was last called with.
 * @returns The submitted value of the `name` field.
 */
function submittedName(): string {
  const formData = action.mock.calls.at(-1)?.[1] as FormData;
  return String(formData.get('name'));
}

describe('NameForm', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('starts on the stored name, so the field shows what the account holds today', () => {
    render(<NameForm name="Ada Lovelace" />);

    expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
  });

  it('starts empty when no name is stored', () => {
    render(<NameForm name={null} />);

    expect(screen.getByLabelText('Display name')).toHaveValue('');
  });

  it('submits the typed name through the Server Action', async () => {
    action.mockResolvedValue({ ok: true, name: 'Grace Hopper' });
    render(<NameForm name={null} />);

    await userEvent.type(screen.getByLabelText('Display name'), 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(submittedName()).toBe('Grace Hopper');
  });

  it('re-renders on the stored value once apps/api has trimmed it (AC-2)', async () => {
    action.mockResolvedValue({ ok: true, name: 'Ada Lovelace' });
    render(<NameForm name={null} />);

    await userEvent.type(
      screen.getByLabelText('Display name'),
      '  Ada Lovelace  ',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText('Display name')).toHaveValue(
      'Ada Lovelace',
    );
  });

  it("submits an empty name rather than blocking it, since '' is what clears it (AC-4)", async () => {
    action.mockResolvedValue({ ok: true, name: '' });
    render(<NameForm name="Ada Lovelace" />);

    await userEvent.clear(screen.getByLabelText('Display name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(submittedName()).toBe('');
  });

  it("shows apps/api's own refusal verbatim (AC-3)", async () => {
    action.mockResolvedValue({
      ok: false,
      error: 'Name must be 80 characters or fewer.',
    });
    render(<NameForm name="Ada Lovelace" />);

    await userEvent.type(screen.getByLabelText('Display name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Name must be 80 characters or fewer.'),
    ).toBeInTheDocument();
  });

  it('keeps what was typed when apps/api refuses it, so a refusal costs no retyping (AC-3)', async () => {
    action.mockResolvedValue({
      ok: false,
      error: 'Name must be 80 characters or fewer.',
    });
    render(<NameForm name="Ada Lovelace" />);

    const field = screen.getByLabelText('Display name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Grace Hopper');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Name must be 80 characters or fewer.'),
    ).toBeInTheDocument();
    expect(field).toHaveValue('Grace Hopper');
  });

  it('lets a refused name be corrected and saved again (AC-3)', async () => {
    action.mockResolvedValueOnce({
      ok: false,
      error: 'Name must be 80 characters or fewer.',
    });
    action.mockResolvedValueOnce({ ok: true, name: 'Ada Lovelace' });
    render(<NameForm name={null} />);

    const field = screen.getByLabelText('Display name');
    await userEvent.type(field, 'x'.repeat(81));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Name must be 80 characters or fewer.'),
    ).toBeInTheDocument();

    // Editing the refused value withdraws the refusal: it was about what was
    // submitted, and leaving the field marked invalid would have the browser's
    // own validation block every further submission.
    await userEvent.clear(field);
    await userEvent.type(field, 'Ada Lovelace');
    expect(
      screen.queryByText('Name must be 80 characters or fewer.'),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(action).toHaveBeenCalledTimes(2);
    expect(submittedName()).toBe('Ada Lovelace');
  });

  it('announces the refusal instead of only painting the field (AC-3)', async () => {
    action.mockResolvedValue({
      ok: false,
      error: 'Name must be 80 characters or fewer.',
    });
    render(<NameForm name="Ada Lovelace" />);

    await userEvent.type(screen.getByLabelText('Display name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The refusal arrives while focus is on Save, and `aria-describedby` alone
    // is only read when the field itself is reached — so a screen reader user
    // would otherwise be told nothing at all happened.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name must be 80 characters or fewer.',
    );
  });

  it('confirms a successful save, since the field alone changing is easy to miss', async () => {
    action.mockResolvedValue({ ok: true, name: 'Ada Lovelace' });
    render(<NameForm name={null} />);

    await userEvent.type(screen.getByLabelText('Display name'), 'Ada Lovelace');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Name saved.');
  });

  it("hints at the API's 80-character rule without enforcing it in place of the API (AC-3)", async () => {
    action.mockResolvedValue({
      ok: false,
      error: 'Name must be 80 characters or fewer.',
    });
    render(<NameForm name={null} />);

    expect(screen.getByText(/80 characters/)).toBeInTheDocument();

    // A client-side cap would swallow the over-long value before apps/api
    // ever saw it, and the refusal AC-3 asks for would never be rendered.
    const field = screen.getByLabelText('Display name');
    expect(field).not.toHaveAttribute('maxLength');

    await userEvent.type(field, 'x'.repeat(81));
    expect(field).toHaveValue('x'.repeat(81));

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submittedName()).toHaveLength(81);
  });
});
