import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserAvatar } from './user-avatar';

/**
 * Makes every `new window.Image()` report an already-decoded image, which is
 * how HeroUI's `Avatar.Image` decides to render the `<img>` at all — jsdom
 * never fetches, so without this the mark stays on its fallback forever and no
 * spec could see the `src` the component asks for.
 * @returns Nothing; the stub is removed by `vi.unstubAllGlobals`.
 */
function stubLoadedImages(): void {
  vi.stubGlobal(
    'Image',
    class {
      complete = true;
      naturalWidth = 1;
      src = '';
      addEventListener() {}
      removeEventListener() {}
    },
  );
}

describe('UserAvatar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('renders no image at all when the account has no avatar (AC-5)', () => {
    stubLoadedImages();

    const { container } = render(
      <UserAvatar name="Ada Lovelace" email="ada@example.com" />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('AL');
  });

  it('renders the avatar through the same-origin proxy, busted by avatarUpdatedAt (D-8, D-13)', () => {
    stubLoadedImages();

    const { container } = render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt="2026-08-21T09:15:30.000Z"
      />,
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute(
      'src',
      `/api/profile/avatar?v=${Date.parse('2026-08-21T09:15:30.000Z')}`,
    );
  });

  it('never routes the private image through next/image, which would 401 (D-13)', () => {
    stubLoadedImages();

    const { container } = render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt="2026-08-21T09:15:30.000Z"
      />,
    );

    expect(container.querySelector('img')?.getAttribute('src')).not.toContain(
      '/_next/image',
    );
  });

  it('still asks for the avatar when the account carries no change time', () => {
    stubLoadedImages();

    const { container } = render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt={null}
      />,
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/profile/avatar?v=0',
    );
  });

  it('leaves the image undescribed, so the labelled mark is announced once', () => {
    stubLoadedImages();

    const { container } = render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt="2026-08-21T09:15:30.000Z"
      />,
    );

    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('returns to the initials when the avatar is removed under it (AC-9)', () => {
    stubLoadedImages();

    const { container, rerender } = render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt="2026-08-21T09:15:30.000Z"
      />,
    );
    expect(container.querySelector('img')).not.toBeNull();

    // What `router.refresh()` produces after a removal: the same mark, told
    // there is no avatar any more. It may not be left blank.
    rerender(<UserAvatar name="Ada Lovelace" email="ada@example.com" />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('AL');
  });

  it('keeps showing the initials while the image is still loading (T-2)', () => {
    // No stub here: jsdom never loads the image, which is exactly the
    // still-loading state. The fallback showing then is an image load, not a
    // state flip, so the mark is never empty.
    render(
      <UserAvatar
        name="Ada Lovelace"
        email="ada@example.com"
        hasAvatar
        avatarUpdatedAt="2026-08-21T09:15:30.000Z"
      />,
    );

    expect(screen.getByLabelText('Your avatar')).toHaveTextContent('AL');
  });
});
