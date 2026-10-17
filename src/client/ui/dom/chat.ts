import './chat.css';
import html from './chat.html?raw';
import { createScreen, query } from './ui';
import { type NetworkClient } from '../../network/network';
import { JumpGate } from '../../objects/jump-gate';
import { type GameObject } from '../../objects/game-object';

/**
 * Sector/global chat shares a compact panel with the targeted gate conversation.
 * All player text is inserted as text nodes, never interpreted as markup.
 */
export const createChat = ({
  network,
  onTyping,
}: {
  network: Pick<
    NetworkClient,
    'displayName' | 'chatMessages' | 'sendChat' | 'requestGateAccess'
  >;
  onTyping: (typing: boolean) => void;
}) => {
  const { element: panel } = createScreen(html);
  const log = query(panel, '.chat-log');
  const contact = query(panel, '.chat-contact');
  const greeting = query(contact, 'p');
  const access = query<HTMLButtonElement>(contact, 'button');
  const input = query<HTMLInputElement>(panel, 'input');
  const buttons =
    panel.querySelectorAll<HTMLButtonElement>('.chat-tabs button');
  let channel = 0;
  let target: JumpGate | undefined;
  let lastMessages: typeof network.chatMessages | undefined;

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      channel = index;
      buttons.forEach((tab, at) =>
        tab.setAttribute('aria-selected', String(at === channel)),
      );
      lastMessages = undefined;
      button.blur();
    });
  });

  document.body.append(panel);

  access.addEventListener('click', () => {
    if (target) network.requestGateAccess(target.id);
    access.blur();
  });

  input.addEventListener('focus', () => onTyping(true));
  input.addEventListener('blur', () => onTyping(false));

  input.addEventListener('keydown', (event) => {
    if (
      event.isComposing ||
      (event.key !== 'Enter' && event.key !== 'Escape')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Enter' && input.value.trim()) {
      network.sendChat(channel, input.value.trim());
      input.value = '';
    }

    input.blur();
  });

  return {
    focus() {
      if (panel.hidden) return false;
      input.focus();
      return true;
    },
    update(object: GameObject | undefined, shown: boolean) {
      panel.hidden = !shown;

      if (!shown) {
        if (document.activeElement === input) input.blur();
        return;
      }

      target = object instanceof JumpGate ? object : undefined;
      contact.hidden = !target;

      if (target) {
        const message = `Greetings ${network.displayName || 'pilot'}, are you traveling to ${target.destinationName}?`;

        if (greeting.textContent !== message) greeting.textContent = message;
        access.disabled = target.openingTarget === 1;
        access.textContent =
          target.openingTarget === 1
            ? 'Access granted'
            : 'Yes — request access';
      }

      if (lastMessages !== network.chatMessages) {
        lastMessages = network.chatMessages;
        const messages = lastMessages.filter(
          (message) => message.channel === channel,
        );

        log.replaceChildren(
          ...messages.map((message) => {
            const line = document.createElement('p');
            const sender = document.createElement('strong');

            sender.textContent = `${message.sender}: `;
            line.append(sender, document.createTextNode(message.text));
            return line;
          }),
        );

        log.scrollTop = log.scrollHeight;
      }
    },
  };
};
