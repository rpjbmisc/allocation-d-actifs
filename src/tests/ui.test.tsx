// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFile } from "node:fs/promises";
import App from "../App";
import { historicalData } from "./fixtures";
import { computePortfolio, formatPercent } from "../analytics";

beforeEach(() => {
  window.history.replaceState({}, "", "/?tab=portfolio&assets=msci_world,gold,us_lt_govt_bonds&start=1970&end=2025&common=false&currency=usd");
  vi.stubGlobal("fetch", async (url: string) => {
    try { return new Response(await readFile(`public${url}`, "utf8")); }
    catch { return new Response("missing", { status: 404 }); }
  });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const UI_TEST_TIMEOUT = 15_000;

it("preserves portfolio controls, manual weights, normalization and selection tabs", async () => {
  const user = userEvent.setup();
  render(<App />);
  const input = await screen.findByRole("spinbutton", { name: "Poids saisi pour MSCI World" });
  const slider = screen.getByRole("slider", { name: "Slider du poids saisi pour MSCI World" });
  expect(screen.getByRole("tab", { name: "Portefeuille" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("button", { name: /Croissance/ })).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: "Plafond de poids par actif" })).toBeTruthy();
  const currentMetrics = () => document.querySelector(".portfolio-summary")?.textContent;
  fireEvent.change(screen.getByRole("spinbutton", { name: "Poids saisi pour Or" }), { target: { value: "30" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Poids saisi pour Obligations d'État US (long terme)" }), { target: { value: "30" } });
  const before = currentMetrics();
  expect(before).toBeTruthy();
  fireEvent.change(input, { target: { value: "40" } });
  expect((slider as HTMLInputElement).value).toBe("40");
  expect(screen.getByText(/Pondérations personnalisées/)).toBeTruthy();
  fireEvent.change(slider, { target: { value: "60" } });
  expect((input as HTMLInputElement).value).toBe("60");
  expect(currentMetrics()).not.toBe(before);
  const expected = computePortfolio(historicalData("usd"), { msci_world: 60, gold: 30, us_lt_govt_bonds: 30 }, 1970, 2025, "nominal")!;
  expect(document.querySelector(".portfolio-kpi strong")?.textContent).toBe(formatPercent(expected.cagr));
  await user.click(screen.getByRole("button", { name: "Normaliser à 100 %" }));
  const total = screen.getAllByRole("spinbutton", { name: /Poids saisi pour/ }).reduce((sum, e) => sum + Number((e as HTMLInputElement).value), 0);
  expect(total).toBeCloseTo(100, 0);
  expect(screen.getByText("Rendement brut / volatilité")).toBeTruthy();
  expect(screen.getByText("Corrélation entre actifs")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Corrélations de la sélection" }));
  await waitFor(() => expect(screen.getByText("Corrélation moyenne des paires")).toBeTruthy());
  await user.click(screen.getByRole("tab", { name: "Portefeuille" }));
  expect((screen.getByRole("spinbutton", { name: "Poids saisi pour MSCI World" }) as HTMLInputElement).value).not.toBe("60");
}, UI_TEST_TIMEOUT);

it("shows an explicit load error if a historical series is unavailable", async () => {
  vi.stubGlobal("fetch", async () => new Response("missing", { status: 404 }));
  render(<App />);
  expect(await screen.findByText(/Données introuvables/)).toBeTruthy();
});

it("exposes comparison and walk-forward spaces without removing manual construction", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("spinbutton", { name: "Poids saisi pour MSCI World" });

  await user.click(screen.getByRole("button", { name: /^Robustesse/ }));
  expect(screen.getByRole("spinbutton", { name: "Nombre de scénarios" })).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Poids saisi pour MSCI World" }), { target: { value: "37" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Nombre de scénarios" }), { target: { value: "40" } });
  expect((screen.getByRole("spinbutton", { name: "Poids saisi pour MSCI World" }) as HTMLInputElement).value).toBe("37");
  expect(screen.getByText(/Pondérations personnalisées/)).toBeTruthy();

  await user.click(screen.getByRole("tab", { name: "Comparaison" }));
  expect(screen.getByText("Comparer les allocations")).toBeTruthy();
  await user.click(screen.getByRole("tab", { name: "Validation" }));
  expect(screen.getByText("Validation walk-forward")).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: "Années d'apprentissage" })).toBeTruthy();
  expect(screen.getByText("Résultats hors échantillon")).toBeTruthy();
  const stabilityInfo = screen.getByRole("button", { name: "Comprendre la stabilité des poids" });
  expect(stabilityInfo.getAttribute("aria-expanded")).toBe("false");
  await user.click(stabilityInfo);
  expect(stabilityInfo.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/Pour Croissance, cet indicateur compare/)).toBeTruthy();
  expect(screen.getByText(/Légende :/)).toBeTruthy();
}, UI_TEST_TIMEOUT);

it("explains all three prospective optimization choices in clear language", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("spinbutton", { name: "Poids saisi pour MSCI World" });
  await user.click(screen.getByRole("button", { name: /^Robustesse/ }));
  await user.click(screen.getByRole("radio", { name: /Futurs possibles/ }));
  for (const choice of ["Limiter les mauvaises surprises", "Mieux résister au pire scénario", "Chercher le meilleur rendement moyen"]) {
    const radio = screen.getByRole("radio", { name: choice });
    expect(radio).toBeTruthy();
    const tip = screen.getByRole("button", { name: `Comprendre : ${choice}` });
    expect(tip).toBeTruthy();
    await user.click(tip);
    expect(tip.getAttribute("aria-expanded")).toBe("true");
    await user.click(radio);
    expect((radio as HTMLInputElement).checked).toBe(true);
  }
}, UI_TEST_TIMEOUT);
