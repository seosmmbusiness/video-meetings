import { redirect } from 'next/navigation';
import { Alert, Button, Card, Chip, EmptyState } from '@heroui/react';
import { logoutAction } from '@/app/actions/auth';
import { getSession } from '@/lib/session';
import {
  ApiError,
  listMeetings,
  splitMeetingsByTime,
  type Meeting,
} from '@/lib/meetings-api';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Formats a meeting's ISO date string for display.
 * @param date - The meeting's `date` field, as an ISO 8601 string.
 * @returns A human-readable date/time, e.g. "Aug 1, 2026, 10:00 AM".
 */
function formatMeetingDate(date: string): string {
  return dateFormatter.format(new Date(date));
}

/**
 * Renders a single meeting as a list row: title, date, and participant count.
 * @param props - The meeting to render.
 * @param props.meeting - The meeting.
 * @returns The rendered list item.
 */
function MeetingListItem({ meeting }: { meeting: Meeting }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-default py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate font-medium">{meeting.title}</p>
        <p className="text-sm text-muted">{formatMeetingDate(meeting.date)}</p>
      </div>
      <Chip
        size="sm"
        color={meeting.participants.length > 0 ? 'accent' : undefined}
      >
        <Chip.Label>
          {meeting.participants.length}{' '}
          {meeting.participants.length === 1 ? 'participant' : 'participants'}
        </Chip.Label>
      </Chip>
    </li>
  );
}

/**
 * Renders a titled card containing a list of meetings, or an empty-state
 * message when there are none.
 * @param props - The section's title, meetings, and empty-state copy.
 * @param props.title - The section heading.
 * @param props.meetings - The meetings to list.
 * @param props.emptyMessage - Message shown when `meetings` is empty.
 * @returns The rendered section.
 */
function MeetingsSection({
  title,
  meetings,
  emptyMessage,
}: {
  title: string;
  meetings: Meeting[];
  emptyMessage: string;
}) {
  return (
    <Card className="w-full">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        {meetings.length > 0 ? (
          <ul>
            {meetings.map((meeting) => (
              <MeetingListItem key={meeting.id} meeting={meeting} />
            ))}
          </ul>
        ) : (
          <EmptyState>{emptyMessage}</EmptyState>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * Home route — the signed-in user's dashboard. Requires an active session:
 * unauthenticated visitors (no session cookie, or one apps/api rejects as
 * expired/tampered when fetching meetings) are redirected to `/login`
 * server-side, before anything renders. Shows the signed-in email, a
 * sign-out button, and the user's meetings split into upcoming and the
 * three most recent past ones.
 * @returns The rendered home page.
 */
export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  let upcoming: Meeting[] = [];
  let recentPast: Meeting[] = [];
  let loadError: string | null = null;

  try {
    const meetings = await listMeetings(session.token);
    ({ upcoming, recentPast } = splitMeetingsByTime(meetings));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      // The cookie is present but apps/api rejects the token itself (expired
      // or tampered) — treat that as signed-out rather than showing a stale
      // dashboard with an error banner. The cookie itself can't be cleared
      // from here (Server Components can't set cookies, only Server Actions
      // and Route Handlers can); it's overwritten on the next successful
      // login/register instead.
      redirect('/login');
    }
    loadError =
      error instanceof ApiError
        ? error.message
        : 'Could not load your meetings. Please try again later.';
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <Card className="w-full">
        <Card.Header>
          <Card.Title>video-meetings</Card.Title>
          <Card.Description>
            Create and join meetings in a few clicks.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Alert status="success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Signed in as {session.email}</Alert.Title>
            </Alert.Content>
          </Alert>
        </Card.Content>
        <Card.Footer>
          <form action={logoutAction}>
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </Card.Footer>
      </Card>

      {loadError ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{loadError}</Alert.Title>
          </Alert.Content>
        </Alert>
      ) : (
        <>
          <MeetingsSection
            title="Upcoming meetings"
            meetings={upcoming}
            emptyMessage="No upcoming meetings yet."
          />
          <MeetingsSection
            title="Recent meetings"
            meetings={recentPast}
            emptyMessage="No past meetings yet."
          />
        </>
      )}
    </main>
  );
}
