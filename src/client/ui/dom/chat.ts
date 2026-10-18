import './chat.css';
import html from './chat.html?raw';
import { createScreen, query, ui } from './ui';
import { type NetworkClient } from '../../network/network';
import { JumpGate } from '../../objects/jump-gate';
import { type GameObject } from '../../objects/game-object';
import { defaultKeybindings, keyLabel } from '../../input/keybindings';
import { jumpGateSpec } from '../../../specs/jump-gate';
import * as Vec from '../../utilities/vector';

const senderColors = new Map([
  ['owner', '#ff0'],
  ['friendly', '#3f7'],
  ['admin', '#4df'],
  ['hostile', '#f44'],
]);

/**
 * Gate conversations and received messages share one chronological chat history.
 * All player text is inserted as text nodes, never interpreted as markup.
 */
export const createChat = ({
  network,
  onTyping,
}: {
  network: Pick<
    NetworkClient,
    | 'displayName'
    | 'world'
    | 'shipId'
    | 'sectorName'
    | 'chatMessages'
    | 'sendChat'
    | 'requestGateAccess'
  >;
  onTyping: (typing: boolean) => void;
}) => {
  const { element: panel } = createScreen(html);
  const log = query(panel, '.chat-log');
  const template = query<HTMLTemplateElement>(panel, 'template');
  const input = query<HTMLInputElement>(panel, 'input');
  const buttons =
    panel.querySelectorAll<HTMLButtonElement>('.chat-tabs button');
  const received = new WeakSet<object>();

  type ChatEntry = {
    message: (typeof network.chatMessages)[number] | JumpGate;
    channel: number;
    element: HTMLElement;
  };

  let entries: ChatEntry[] = [];
  let sector = network.sectorName;
  let channel = 0;
  let renderedChannel = 0;
  let target: JumpGate | undefined;
  let access: HTMLButtonElement | undefined;

  let pending: (ChatEntry & { message: JumpGate }) | undefined;

  const finishPending = (text: string) => {
    if (!pending) return;
    query(pending.element, 'button > span').textContent = text;
    pending = undefined;
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      channel = index;
      buttons.forEach((tab, at) =>
        tab.setAttribute('aria-pressed', String(at === channel)),
      );
      button.blur();
    });
  });

  ui.element.append(panel);
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
    requestGateAccess() {
      if (!panel.hidden && channel === 0) access?.click();
    },
    focus() {
      if (panel.hidden) return false;
      input.focus();
      return true;
    },
    update(object: GameObject | undefined, shown: boolean) {
      if (sector !== network.sectorName) {
        sector = network.sectorName;
        entries = entries.filter((entry) => entry.channel === 1);
        target = undefined;
        pending = undefined;
      }

      entries = entries.filter(
        (entry) =>
          entry.message instanceof JumpGate ||
          network.chatMessages.includes(entry.message),
      );

      network.chatMessages.forEach((message) => {
        if (received.has(message)) return;
        received.add(message);

        if (
          pending &&
          message.channel === 0 &&
          message.senderRole === 'friendly' &&
          message.sender === pending.message.name &&
          message.text !== jumpGateSpec.accessPendingMessage &&
          message.text !== jumpGateSpec.closingMessage &&
          message.text !== jumpGateSpec.closingInterruptedMessage
        ) {
          if (message.text === jumpGateSpec.accessGrantedMessage) {
            query(pending.element, 'button > span').textContent =
              'Access granted';
          } else {
            finishPending('Access unavailable');
          }
        }

        const line = document.createElement('p');
        const sender = document.createElement('strong');

        sender.textContent = `${message.sender}: `;
        line.append(sender, document.createTextNode(message.text));
        entries.push({ message, channel: message.channel, element: line });
      });

      panel.hidden = !shown;
      const ship = network.world.entities.get(network.shipId!);

      if (pending) {
        const gate = pending.message;

        if (
          !ship ||
          ship.dead ||
          ship.dockedTo ||
          network.world.entities.get(gate.id) !== gate ||
          gate.openingTarget === 1 ||
          Vec.distanceSquared(ship.position, gate.position) >
            jumpGateSpec.approachRadius ** 2
        ) {
          finishPending(
            gate.openingTarget === 1 ? 'Access granted' : 'Access unavailable',
          );
        }
      }

      target =
        object instanceof JumpGate &&
        network.world.entities.get(object.id) === object
          ? object
          : undefined;
      const canRequest =
        target &&
        ship &&
        !ship.dead &&
        !ship.dockedTo &&
        target.openingTarget !== 1 &&
        Vec.distanceSquared(ship.position, target.position) <=
          jumpGateSpec.approachRadius ** 2;
      let greetingAdded = false;
      const accessKeys = defaultKeybindings.requestGateAccess.keys
        .map(keyLabel)
        .join(' / ');

      access = undefined;

      entries.forEach(({ message, element }) => {
        if (message instanceof JumpGate) {
          const button = query<HTMLButtonElement>(element, 'button');

          // Historical requests stay disabled, even when this gate is eligible again.
          if (!button.disabled) {
            button.disabled = message !== target || !canRequest;

            if (message.openingTarget === 1) {
              query(button, 'span').textContent = 'Access granted';
            }
          }

          query(button, 'kbd').textContent = accessKeys;

          if (message === target && !button.disabled) access = button;
        } else {
          query(element, 'strong').style.setProperty(
            '--sender-color',
            message.sender === network.displayName &&
              !['admin', 'owner'].includes(message.senderRole)
              ? '#e6f'
              : senderColors.get(message.senderRole) || '#fff',
          );
        }
      });

      if (!shown) {
        if (document.activeElement === input) input.blur();
        return;
      }

      if (target && canRequest && pending?.message !== target && !access) {
        const gate = target;
        const line = template.content.firstElementChild!.cloneNode(
          true,
        ) as HTMLElement;
        const button = query<HTMLButtonElement>(line, 'button');
        const entry = { message: gate, channel: 0, element: line };

        if (entries.some(({ message }) => message === gate)) {
          line.removeChild(query(line, 'p'));
        } else {
          query(line, 'strong').textContent = `${gate.name}: `;
          query(line, 'p > span').textContent = jumpGateSpec.greetingMessage
            .replace('{player}', () => network.displayName || 'pilot')
            .replace('{destination}', () => gate.destinationName);
        }

        button.addEventListener('click', () => {
          if (
            !button.disabled &&
            !panel.hidden &&
            channel === 0 &&
            target === gate
          ) {
            finishPending('Access unavailable');
            pending = entry;
            button.disabled = true;
            query(button, 'span').textContent = 'Access pending';
            network.requestGateAccess(gate.id);
          }

          button.blur();
        });

        query(button, 'kbd').textContent = accessKeys;
        entries.push(entry);
        access = button;
        greetingAdded = true;
      }

      entries = entries.slice(-100);

      const nodes = entries
        .filter((entry) => entry.channel === channel)
        .map((entry) => entry.element);
      const scrollTop = log.scrollTop;
      const atBottom = log.scrollHeight - scrollTop - log.clientHeight < 4;

      if (
        nodes.length !== log.children.length ||
        nodes.some((node, i) => node !== log.children[i])
      ) {
        log.replaceChildren(...nodes);
        log.hidden = !nodes.length;

        if (atBottom || greetingAdded || renderedChannel !== channel) {
          log.scrollTop = log.scrollHeight;
        } else {
          log.scrollTop = scrollTop;
        }
      }

      renderedChannel = channel;
    },
  };
};
