import { isHubsSceneUrl, isHubsRoomUrl } from "../utils/media-utils";
import { guessContentType } from "../utils/media-utils";

AFRAME.registerComponent("open-media-button", {
  init() {
    this.label = this.el.querySelector("[text]");

    this.updateSrc = () => {
      const src = (this.src = this.targetEl.components["media-loader"].data.src);
      const visible = src && guessContentType(src) !== "video/vnd.hubs-webrtc";
      this.el.object3D.visible = !!visible;

      if (visible) {
        let label = "open link";
        if (isHubsSceneUrl(src)) {
          label = "use scene";
        } else if (isHubsRoomUrl(src)) {
          label = "visit room";
        }
        this.label.setAttribute("text", "value", label);
      }
    };

    this.onClick = () => {
      if (isHubsSceneUrl(this.src)) {
        this.el.sceneEl.emit("scene_media_selected", this.src);
      } else if (isHubsRoomUrl(this.src)) {
        location.href = this.src;
      } else {
        window.open(this.src);
      }
    };

    NAF.utils.getNetworkedEntity(this.el).then(networkedEl => {
      this.targetEl = networkedEl;
      this.targetEl.addEventListener("media_resolved", this.updateSrc, { once: true });
      this.updateSrc();
    });
  },

  play() {
    this.el.object3D.addEventListener("interact", this.onClick);
  },

  pause() {
    this.el.object3D.removeEventListener("interact", this.onClick);
  }
});
