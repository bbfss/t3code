import { useGT } from "gt-react";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { useSearchableSetting } from "../components/settings/settingsSearch";
import { Switch } from "../components/ui/switch";
import { updateBbfssSettings, useBbfssSettings } from "./settings";

export function BbfssSettingsPanel() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useBbfssSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="bbfss" title={gt("bbfss 改动")}>
        <SettingsRow
          {...searchableSetting("bbfss-completion-quick-reply")}
          description={gt(
            "后台会话完成时在右上角显示带历史预览与输入框的浮窗，可不切换当前会话直接继续提问；关闭后恢复原版提示。",
          )}
          control={
            <Switch
              checked={settings.completionQuickReplyEnabled}
              onCheckedChange={(checked) =>
                updateBbfssSettings({ completionQuickReplyEnabled: Boolean(checked) })
              }
              aria-label={gt("会话完成快捷续聊弹窗")}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
