import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UserAvatar } from './user-avatar';

describe('UserAvatar', () => {
  it('renders the initials of a two-part name', () => {
    render(<UserAvatar name="Ada Lovelace" email="ada@example.com" />);

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('AL');
  });

  it('renders a single initial for a one-word name', () => {
    render(<UserAvatar name="Ada" email="ada@example.com" />);

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('A');
  });

  it('takes only the first two words of a longer name', () => {
    render(<UserAvatar name="Augusta Ada King Noel" email="ada@example.com" />);

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('AA');
  });

  it("falls back to the email's first letter when no name is set (D-13)", () => {
    render(<UserAvatar name={null} email="ada@example.com" />);

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('A');
  });

  it('falls back to the email when the name is blank rather than showing nothing', () => {
    render(<UserAvatar name="   " email="ada@example.com" />);

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('A');
  });

  it('renders a name of markup as text, never as an element (AC-16)', () => {
    const { container } = render(
      <UserAvatar
        name={`<img src=x onerror="document.title='xss'">`}
        email="ada@example.com"
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Your avatar')).toBeInTheDocument();
  });

  it('accepts an accessible label of its own, so the same mark can appear elsewhere', () => {
    render(
      <UserAvatar name="Ada Lovelace" email="ada@example.com" label="Ada" />,
    );

    expect(screen.getByLabelText('Ada')).toHaveTextContent('AL');
  });
});
