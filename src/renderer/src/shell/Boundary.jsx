import { Component } from "react";
import { noteError } from "../lib/errors";
import { CrashHelp } from "../App";

export class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    noteError(`Something broke in this view: ${err.message}`, "crash");
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="loading" role="alert">
        <h3>Something broke in this view</h3>
        <p className="muted" style={{ maxWidth: 520, textAlign: "center" }}>
          {this.state.err.message}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={() => this.setState({ err: null })}>
            Try again
          </button>
          <CrashHelp err={this.state.err} />
        </div>
      </div>
    );
  }
}
