'use client';

import { type ComponentProps, useRef, useState } from 'react';
import { type VariantProps } from 'class-variance-authority';
import { PhoneOffIcon } from 'lucide-react';
import { useSessionContext } from '@livekit/components-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { recordSessionDiagnostic } from '@/lib/session-diagnostics';
import { cn } from '@/lib/shadcn/utils';

/**
 * Props for the AgentDisconnectButton component.
 */
export interface AgentDisconnectButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /**
   * Custom icon to display. Defaults to PhoneOffIcon.
   */
  icon?: React.ReactNode;
  /** Optional navigation after the session has disconnected. */
  onDisconnected?: () => void | Promise<void>;
  /**
   * The size of the button.
   * @default 'default'
   */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /**
   * The variant of the button.
   * @default 'destructive'
   */
  variant?: 'default' | 'outline' | 'destructive' | 'ghost' | 'link';
  /**
   * The children to render.
   */
  children?: React.ReactNode;
  /**
   * The callback for when the button is clicked.
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * A button to disconnect from the current agent session.
 * Calls the session's end() method when clicked.
 *
 * @extends ComponentProps<'button'>
 *
 * @example
 * ```tsx
 * <AgentDisconnectButton onClick={() => console.log('Disconnecting...')} />
 * ```
 */
export function AgentDisconnectButton({
  icon,
  size = 'default',
  variant = 'destructive',
  children,
  onClick,
  onDisconnected,
  disabled,
  ...props
}: AgentDisconnectButtonProps) {
  const { end } = useSessionContext();
  const endingRef = useRef(false);
  const [ending, setEnding] = useState(false);
  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (endingRef.current) return;
    recordSessionDiagnostic('end-clicked');
    endingRef.current = true;
    setEnding(true);
    onClick?.(event);
    try {
      await end();
    } catch {
      // A page reset also releases media if graceful disconnection fails.
    } finally {
      if (onDisconnected) {
        await onDisconnected();
      } else {
        endingRef.current = false;
        setEnding(false);
      }
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={disabled || ending}
      {...props}
    >
      {icon ?? <PhoneOffIcon />}
      {children ?? <span className={cn(size?.includes('icon') && 'sr-only')}>END CALL</span>}
    </Button>
  );
}
