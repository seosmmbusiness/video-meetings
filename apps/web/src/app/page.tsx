'use client';

import { Button, Card } from '@heroui/react';

/**
 * Home route — landing page introducing the video-meetings app.
 * @returns The rendered home page.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-[400px]">
        <Card.Header>
          <Card.Title>video-meetings</Card.Title>
          <Card.Description>
            Create and join meetings in a few clicks.
          </Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button onPress={() => console.log('Get started pressed')}>
            Get started
          </Button>
        </Card.Footer>
      </Card>
    </main>
  );
}
