import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FilePreview } from './file-preview';

const SRC = '/api/meetings/meeting-1/files/file-1/content';

describe('FilePreview', () => {
  it('starts collapsed, so N rows do not all start loading media at once', () => {
    const { container } = render(
      <FilePreview src={SRC} mimeType="video/mp4" name="standup.mp4" />,
    );

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });

  it('renders a video element pointed at the same-origin byte route once expanded', async () => {
    const { container } = render(
      <FilePreview src={SRC} mimeType="video/mp4" name="standup.mp4" />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(container.querySelector('video')).toHaveAttribute('src', SRC);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('renders an image with the file name as its alt text', async () => {
    render(<FilePreview src={SRC} mimeType="image/png" name="diagram.png" />);

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('img', { name: 'diagram.png' })).toHaveAttribute(
      'src',
      SRC,
    );
  });

  it("hands a PDF to the browser's own viewer in an iframe (S-8)", async () => {
    render(
      <FilePreview src={SRC} mimeType="application/pdf" name="agenda.pdf" />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTitle('agenda.pdf').tagName).toBe('IFRAME');
  });

  it('collapses again on a second press', async () => {
    const { container } = render(
      <FilePreview src={SRC} mimeType="audio/mpeg" name="call.mp3" />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));

    expect(container.querySelector('audio')).toBeNull();
  });
});
