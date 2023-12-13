import { VideoConfMeeting } from "./VideoConfMeeting";
import { ParticipantVideo, ScreenShare, SelfVideo, VideoStream } from "./VideoStream";
import { Person } from "../Abstract/Person";
import { assert, sleep } from "../util/util";
import axios from "axios";

export class OTalkConf extends VideoConfMeeting {
  /** OTalk controller server hostname */
  controllerHost: string;
  /** Where guests would go to join the meeting without Mustang app */
  webFrontendHost: string;
  /* Authentication */
  password: string;
  private authToken: string;
  private refreshToken: string;
  /* Live connection with the controller, during a conference */
  protected webSocket: WebSocket;
  protected axios: any;
  /* Current meeting */
  eventID: string;
  roomID: string;
  myParticipantID: string;
  errorCallback = (ex) => { console.error(ex); };
  /** Our camera and mic.
   * Set this using setCamera() */
  protected camera: MediaStream | null = null;

  get selfVideo(): SelfVideo | null {
    return this.videos.find(v => v instanceof SelfVideo) ?? null;
  }

  /**
   * Login using OAuth2
   * If already logged in, does nothing.
   * @param relogin if true: Force a new login in any case.
   */
  async login(relogin = false) {
    if (this.authToken && !relogin) {
      return;
    }
    // TODO config
    this.controllerHost = "controller.mustang.im";
    this.webFrontendHost = "mustang.im";
    let authToken = localStorage.getItem("conf.otalk.authToken") as string;
    assert(authToken, "OTalk: Need authentication. Need conf.otalk.authToken in localStorage");
    this.authToken = authToken;

    // TODO OAuth2 login

    this.axios = axios.create({
      baseURL: `https://${this.controllerHost}/v1/`,
      timeout: 3000,
      headers: {
        authentication: `Bearer ${this.authToken}`,
      }
    });
  }

  async createNewConference() {
    await this.login();
    let time = new Date().toLocaleString(navigator.language, { hour: "numeric", minute: "numeric" });
    let response = await this.axios.post("events", {
      body: {
        title: `Meeting ${time}`,
        description: "",
        is_time_independent: true,
        waiting_room: false,
        recurrence_pattern: [],
        is_adhoc: true
      }
    });
    let event = response.data;
    console.log("new conference", event);
    this.eventID = event.id;
    this.roomID = event.room.id;
    console.log(await this.getInvitationURL());
  }

  async getInvitationURL(): Promise<URLString> {
    assert(this.roomID, "Need to create the conference first");
    let response = await this.axios.post(`rooms/${this.roomID}/invites`, {
      body: {},
    });
    let invitation = await response.data;
    return `https://${this.webFrontendHost}/invite/${invitation.invite_code}`;
  }

  async aboutMe(): Promise<{ name: string, picture: URLString, email: string, id: string }> {
    let response = await this.axios.get("users/me");
    let me = await response.data;
    me.name = me.display_name;
    me.picture
    return {
      name: me.display_name,
      email: me.email,
      picture: me.avatar_url,
      id: me.id,
    };
  }

  /**
   * After opening our user's camera and microphone
   * using `getUserMedia()`, pass the stream here.
   *
   * You should preferably do that before `start()`ing the conference,
   * but you can do it at any time.
   *
   * @param MediaStream from getUserMedia()
   *   If null, the current stream will be removed.
   */
  async setCamera(mediaStream: MediaStream | null) {
    if (!mediaStream) {
      if (!this.camera) {
        return;
      }
      let old = this.camera;
      this.camera = null;
      await this.removeMyVideo(old);
      return;
    }
    assert(mediaStream instanceof MediaStream, "Need a media stream for the camera");
    if (this.camera) {
      await this.setCamera(null); // Remove previous
    }
    this.camera = mediaStream;
    if (this.myParticipantID) {
      this.sendVideo(this.camera);
    }
  }

  async start() {
    assert(this.roomID, "Need to create the conference first");
    await super.start();
    await this.axios.get(`rooms/${this.roomID}/start`);
    await this.axios.get(`turn`);
    await this.createWebSocket();
    await this.join();
    this.addMsgListener("control", "joined", false, false, (json) => this.participantJoined(json));
    this.addMsgListener("control", "left", false, false, (json) => this.participantLeft(json));
    this.addMsgListener("media", "webrtc_down", false, false, (json) => this.participantVideoStopped(json));
  }

  protected async join() {
    let me = await this.aboutMe();
    this.send("control", "join", {
      display_name: me.name,
    });
    let myParticipantInfo = await this.waitForMessage("control", "join_success") as
      ParticipantInfoJSON;
    this.myParticipantID = myParticipantInfo.id;
    if (this.camera && this.camera.active) {
      await this.sendVideo(this.camera);
    }
  }

  /**
   * Handles control joined
   * Called when other participants join the conference.
   */
  protected async participantJoined(json: any) {
    let participant = new Person();
    participant.id = json.id;
    participant.name = json.control.display_name;
    this.participants.add(participant);
    if (json.media?.video?.video || json.media?.video?.audio) {
      await this.getVideoFromParticipant(participant);
    }
  }

  /** Handles media.webrtc_down */
  protected participantVideoStopped(json: any) {
    let participantId = json.source;
    let video = this.videos.find(v => (v instanceof ParticipantVideo || v instanceof ScreenShare) &&
      v.participant?.id == participantId);
    this.videos.remove(video);
  }

  /** Handles control/left */
  protected participantLeft(json: any) {
    let participantId = json.id;
    let participant = this.participants.find(p => p.id == participantId);
    this.participants.remove(participant);
    let video = this.videos.find(v => (v instanceof ParticipantVideo || v instanceof ScreenShare) &&
      v.participant == participant);
    this.videos.remove(video);
  }

  async answer() {
    super.answer();
  }

  async hangup() {
    this.send("media", "unpublish", {
      media_session_type: "video",
    });
    await this.closeWebSocket();
    super.hangup();
  }

  static async createAdhoc(): Promise<OTalkConf> {
    let meet = new OTalkConf();
    await meet.createNewConference();
    await meet.start();
    return meet;
  }

  ///////////////////////
  // WebRTC handling

  protected async sendVideo(mediaStream: MediaStream) {
    assert(mediaStream.active, "MediaStream needs to be active");
    let videoStream = new SelfVideo(mediaStream);
    this.videos.add(videoStream);

    let peerConnection = new RTCPeerConnection(this.getPeerConnectionConfig());
    for (let track of mediaStream.getTracks()) {
      peerConnection.addTrack(track);
    }
    let offer = await peerConnection.createOffer();
    this.send("media", "publish", {
      target: this.myParticipantID,
      media_session_type: "video",
      sdp: offer.sdp,
    });
    await this.sendICECandidates(peerConnection, this.myParticipantID);
    let answer = await this.waitForMessage("media", "sdp_answer");
    assert(answer.source == this.myParticipantID, "Videos of participants got mixed up in their order");
    await peerConnection.setRemoteDescription(answer.sdp);
    let up = await this.waitForMessage("media", "webrtc_up");
    assert(up.source == this.myParticipantID, "WebRTC up of participants got mixed up in their order");
  }

  protected async removeMyVideo(mediaStream: MediaStream) {
    // TODO Tell controller to remove our video
  }
  // TODO re-subscribe to other participant's video, if it dropped

  async getVideoFromParticipant(participant: Person) {
    this.send("media", "subscribe", {
      target: participant.id,
      media_session_type: "video",
    });
    let videoStream = new ParticipantVideo(new MediaStream(), participant);
    // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling
    // https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
    let peerConnection = new RTCPeerConnection(this.getPeerConnectionConfig());
    peerConnection.ontrack = (event) => {
      let track = event.track;
      assert(track instanceof MediaStreamTrack, "Didn't get a track");
      videoStream.stream.addTrack(track);
    };
    // TODO peerConnection.addEventListener("removetrack")?
    let offer = await this.waitForMessage("media", "sdp_offer");
    assert(offer.source == participant.id, "Videos of participants got mixed up in their order");
    await peerConnection.setRemoteDescription(offer.sdp);
    let answer = await peerConnection.createAnswer();
    this.send("media", "sdp_answer", {
      target: participant.id,
      media_session_type: "video",
      sdp: answer.sdp,
    });
    await this.sendICECandidates(peerConnection, participant.id);
    let up = await this.waitForMessage("media", "webrtc_up");
    assert(up.source == participant.id, "WebRTC up of participants got mixed up in their order");
    this.send("media", "configure", {
      target: participant.id,
      media_session_type: "video",
      configuration: {
        video: true, // ?
      }
    });
    this.videos.add(videoStream);
  }

  async sendICECandidates(peerConnection: RTCPeerConnection, participantID: string) {
    peerConnection.onicecandidate = (event) => {
      // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidate_event
      let candidateObj = event.candidate;
      if (candidateObj == null) {
        console.info("ICE candidates complete");
        return;
      } else if (candidateObj.candidate == "") {
        this.send("media", "sdp_end_of_candidates", {
          target: participantID,
          media_session_type: "video",
        });
      } else if (candidateObj.candidate) {
        this.send("media", "sdp_candidate", {
          target: participantID,
          media_session_type: "video",
          candidate: {
            sdpMid: candidateObj.sdpMid,
            sdpMLineIndex: candidateObj.sdpMLineIndex,
            candidate: candidateObj.candidate,
          }
        });
      }
    }
    peerConnection.onicegatheringstatechange = (event) => {
      console.log("ICE gathering state", peerConnection.iceGatheringState);
    }
    /*await new Promise(resolve => {
      peerConnection.onicegatheringstatechange = (event) => {
        if (peerConnection.iceGatheringState == "complete") {
          resolve(null);
        }
      }
    });*/
  }

  getPeerConnectionConfig() {
    return {
      iceServers: [
        {
          urls: "stun:stun.sipgate.net:10000", // TODO Get our TURN server
        },
      ],
    };
  }

  ////////////////////////
  // WebSocket handling

  protected async createWebSocket() {
    this.webSocket = new WebSocket(`wss://${this.controllerHost}/signaling`);
    await new Promise(resolve => { // wait for connection to be established
      this.webSocket.onopen = resolve;
    });
    this.webSocket.onmessage = (event) => this.handleIncomingMsg(event);
  }

  protected async handleIncomingMsg(event) {
    try {
      let eventData = JSON.parse(event.data);
      let module = eventData.namespace;
      let payload = eventData.payload;
      for (let listener of this.msgListeners.slice().reverse()) {
        if (listener.module != module ||
          !(listener.module == "control" || listener.module == "media") ||
          listener.msg != payload[messageProp[listener.module]]) {
          continue;
        }
        try {
          await listener.listener(payload);
        } catch (ex) {
          this.errorCallback(ex);
        }
        if (listener.override) {
          break;
        }
        if (listener.once) {
          arrayRemoveLast(this.msgListeners, listener);
        }
      }
    } catch (ex) {
      this.errorCallback(ex);
    }
  }

  private msgListeners: Array<{
    /** JSON namespace */
    module: JSONNamespaces,
    /**
     * The listener will be triggered, if the namespace matches and
     * the property JSON .payload.message (or .action) has this value,
     * e.g. payload.action == msg;
     *
     * For control: `message`
     * For media: `action`
     */
    msg: string,
    /** Do not call earlier handlers for the same message */
    override: boolean,
    /** Call this listener only once, then remove it */
    once: boolean,
    /**
     * @param json: The JSON payload object
     */
    listener: (json: any) => Promise<void> | void,
  }> = [];

  /**
   * Adds a handler for the given message on the controller web socket
   * @param callback will be called with the JSON payload of the message.
   * @once Call the listener only once, then stop listening for this msg.
   * @override Do not call earlier listeners for the same message
   */
  addMsgListener(module: JSONNamespaces, msg: string, once = false, override = false,
    callback: (json: any) => Promise<void> | void) {
    this.msgListeners.push({
      module,
      msg,
      once,
      override,
      listener: callback,
    });
  }

  removeMsgListener(callback: (json: any) => Promise<void> | void) {
    let pos = this.msgListeners.findIndex(l => l.listener == callback);
    if (pos != -1) {
      this.msgListeners.splice(pos, 1);
    }
  }

  /**
   * Waits until the given message arrives on the controller web socket
   * @returns the JSON payload of that msg
   */
  async waitForMessage(module: JSONNamespaces, msg: string): Promise<any> {
    return await new Promise(resolve => {
      this.addMsgListener(module, msg, true, false, resolve);
    });
  }

  send(module: JSONNamespaces, msg: string, json: any) {
    json[messageProp[module]] = msg;
    this.webSocket.send(JSON.stringify(json));
  }

  protected async closeWebSocket() {
    if (this.webSocket.readyState == WebSocket.CLOSED ||
      this.webSocket.readyState == WebSocket.CLOSING) {
      return;
    }
    while (this.webSocket.bufferedAmount > 0) {
      await sleep(0.01);
    }
    this.webSocket.close();
  }
}

export function arrayRemoveLast(array, item) {
  let pos = array.lastIndexOf(item);
  if (pos > -1) {
    array.splice(pos, 1);
  }
}

type JSONNamespaces = "control" | "media";
const messageProp = {
  control: "message",
  media: "action",
}

class ParticipantInfoJSON {
  id: string;
  display_name: string;
  avatar_url: URLString;
  role: "moderator" | "guest";
}

type URLString = string;