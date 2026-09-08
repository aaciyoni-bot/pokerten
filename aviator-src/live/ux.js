/* Shared chat behaviour for the live AVIATORIZIS screen. No game settlement logic. */
(function (root) {
  "use strict";
  root.AviatorUX = {
    createChat({document: doc, send, getUser, getName}) {
      const el = id => doc.getElementById(id);
      const modal = el("chatModal"), input = el("chatInput"), button = el("chatSend");
      const list = el("chatList"), status = el("chatStatus"), opener = el("chatBtn");
      let sending = false, returnFocus = null;
      function announce(message, error = false) {
        status.textContent = message;
        status.classList.toggle("error", error);
      }
      function close() {
        modal.classList.remove("on");
        opener.setAttribute("aria-expanded", "false");
        el("app").inert = false;
        if (returnFocus && returnFocus.isConnected) returnFocus.focus();
      }
      function open() {
        returnFocus = doc.activeElement;
        modal.classList.add("on");
        opener.classList.remove("on");
        opener.setAttribute("aria-expanded", "true");
        el("app").inert = true;
        list.scrollTop = list.scrollHeight;
        // Focus the heading/close control: do not raise the mobile keyboard unexpectedly.
        el("chatClose").focus();
      }
      opener.addEventListener("click", open);
      el("chatClose").addEventListener("click", close);
      modal.addEventListener("click", event => { if (event.target === modal) close(); });
      modal.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); close(); return; }
        if (event.key !== "Tab") return;
        const focusable = [...modal.querySelectorAll("button:not(:disabled), input:not(:disabled), [tabindex='0']")];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      input.addEventListener("input", () => {
        el("chatCount").textContent = `${input.value.length}/140`;
      });
      el("chatForm").addEventListener("submit", async event => {
        event.preventDefault();
        if (sending) return;
        const text = input.value.trim().slice(0, 140), user = getUser();
        if (!text) { announce("כתוב הודעה לפני השליחה", true); input.focus(); return; }
        if (!user) { announce("יש להתחבר כדי לשלוח הודעה. הטיוטה שלך נשמרה כאן.", true); return; }
        const draft = input.value;
        sending = true; button.disabled = true; input.readOnly = true;
        button.textContent = "שולח…";
        el("chatForm").setAttribute("aria-busy", "true");
        announce("שולח את ההודעה…");
        try {
          await send({uid: user.uid, name: getName(), text, ts: Date.now()});
          if (input.value === draft) input.value = "";
          el("chatCount").textContent = `${input.value.length}/140`;
          announce("ההודעה נשלחה");
          list.scrollTop = list.scrollHeight;
        } catch (_) {
          announce("השליחה נכשלה. ההודעה נשארה כאן — אפשר לנסות שוב.", true);
        } finally {
          sending = false; button.disabled = false; input.readOnly = false;
          button.textContent = "שלח";
          el("chatForm").setAttribute("aria-busy", "false");
          if (modal.classList.contains("on")) input.focus();
        }
      });
      return {
        render(messages) {
          const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 60;
          const scrollTop = list.scrollTop;
          const uid = getUser()?.uid;
          const fragment = doc.createDocumentFragment();
          if (!messages.length) {
            const empty = doc.createElement("p");
            empty.className = "chatEmpty";
            empty.textContent = "ברוכים הבאים לצ׳אט. כאן אפשר לדבר עם שאר הטייסים.";
            fragment.append(empty);
          }
          for (const message of messages) {
            const row = doc.createElement("article");
            row.className = `chatMsg${message.uid === uid ? " me" : ""}`;
            const head = doc.createElement("div"); head.className = "chatMeta";
            const name = doc.createElement("b"); name.textContent = message.name || "Pilot";
            head.append(name);
            if (Number.isFinite(message.ts)) {
              const time = doc.createElement("time");
              const date = new Date(message.ts);
              if (Number.isFinite(date.getTime())) {
                time.dateTime = date.toISOString();
                time.textContent = date.toLocaleTimeString("he-IL", {hour:"2-digit", minute:"2-digit"});
                head.append(time);
              }
            }
            const body = doc.createElement("p"); body.dir = "auto"; body.textContent = message.text || "";
            row.append(head, body); fragment.append(row);
          }
          list.replaceChildren(fragment);
          list.scrollTop = stick ? list.scrollHeight : scrollTop;
        }
      };
    }
  };
})(window);
