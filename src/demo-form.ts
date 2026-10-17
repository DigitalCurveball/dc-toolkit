// A demo site's form, which never sends: a submit is stopped, and the notice the form keeps in
// its <template> is copied into its live region (role="status"), which screen readers announce.
// Without scripts the form goes nowhere, so the form carries the same notice in a <noscript>.
// The site's form supplies the markup and its look:
//
//   <form action="#" method="post" novalidate data-demo>
//     …fields, the button…
//     <p class="notice" role="status"></p>
//     <template>Nothing was sent: this is a demo. … <a href="…">See the offer</a></template>
//     <noscript><p class="notice">…the same…</p></noscript>
//   </form>
//   <script>import 'dc-toolkit/demo-form';</script>
//
// Keep the live region in the accessibility tree while it is empty (clipped, not display: none):
// one that appears only when its text arrives may go unannounced in NVDA and JAWS.
for (const form of document.querySelectorAll<HTMLFormElement>('form[data-demo]')) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.querySelector('[role="status"]');
    const notice = form.querySelector('template');
    if (status && notice) status.replaceChildren(notice.content.cloneNode(true));
  });
}
