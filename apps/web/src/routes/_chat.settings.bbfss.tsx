import { createFileRoute } from "@tanstack/react-router";
import { BbfssSettingsPanel } from "../bbfss/BbfssSettingsPanel";

export const Route = createFileRoute("/_chat/settings/bbfss")({ component: BbfssSettingsPanel });
