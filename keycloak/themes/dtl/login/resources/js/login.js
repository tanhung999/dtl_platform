document.addEventListener("DOMContentLoaded", () => {
  if (window.self !== window.top) {
    document.documentElement.classList.add("dtl-embedded");
    document.body.classList.add("dtl-embedded");
  }
  const username = document.getElementById("username");
  if (username) {
    username.setAttribute("autocomplete", "one-time-code");
    username.setAttribute("autocapitalize", "none");
    username.setAttribute("spellcheck", "false");
  }
});
