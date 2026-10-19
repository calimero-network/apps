import { Icon } from "../components/Icon";
import { GITHUB } from "./Nav";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-cta">
        <h2>Bring your people onto one map.</h2>
        <a className="btn btn-primary" href={GITHUB}>
          <Icon name="github" size={18} /> Get Mero Tag on GitHub
        </a>
      </div>
      <div className="footer-row">
        <span>
          <img src="/icon.svg" alt="" width={20} height={20} /> Mero Tag
        </span>
        <span>
          Built on <a href="https://calimero.network">Calimero</a> · <a href={GITHUB}>Source</a> · MIT licensed
        </span>
      </div>
    </footer>
  );
}
