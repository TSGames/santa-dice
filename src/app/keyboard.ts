/**
 * Keeps a focused input visible above the on-screen keyboard on phones.
 * Browsers (iOS in particular) only shrink the visual viewport when the keyboard opens, so the
 * focused field can end up behind it. Once the keyboard is open, the field is scrolled to the middle
 * of the visible area.
 */
export function keepInputsAboveKeyboard() {
  document.addEventListener('focusin', (event) => {
    const el = event.target as HTMLElement;
    if (!el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) {
      return;
    }
    const viewport = window.visualViewport;
    const reveal = () => {
      if (document.activeElement !== el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const top = viewport ? viewport.offsetTop : 0;
      const height = viewport ? viewport.height : window.innerHeight;
      // Only move if the field is (partly) outside the visible area
      if (rect.top < top + 8 || rect.bottom > top + height - 8) {
        window.scrollBy({top: rect.top + rect.height / 2 - (top + height / 2), behavior: 'smooth'});
      }
    };
    if (viewport) {
      const onResize = () => {
        viewport.removeEventListener('resize', onResize);
        reveal();
      };
      viewport.addEventListener('resize', onResize);
      setTimeout(() => viewport.removeEventListener('resize', onResize), 1500);
    }
    // Fallback if the viewport does not report the keyboard
    setTimeout(reveal, 400);
  });
}
