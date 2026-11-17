"""Reviewed pyJianYingDraft 0.3.1 creation-only adapter. Never controls or exports Jianying."""
import sys, json, os
from importlib.metadata import version

def main():
    if version('pyjianyingdraft') != '0.3.1':
        raise RuntimeError('Expected pinned pyjianyingdraft 0.3.1')
    import pyJianYingDraft as d
    with open(sys.argv[1], encoding='utf-8-sig') as f:
        data = json.load(f)
    p = data['plan']
    target = os.path.join(data['draftRoot'], data['name'])
    if os.path.exists(target):
        raise FileExistsError('Never overwrite a draft')
    for f in data['files']:
        if not os.path.isfile(f['path']):
            raise FileNotFoundError(f['path'])
    folder = d.DraftFolder(data['draftRoot'])
    script = folder.create_draft(data['name'], p['width'], p['height'], p['fps'], allow_replace=False)
    limitations = []
    for i, clip in enumerate(p['clips']):
        name = 'video-' + str(i)
        script.append_track(d.TrackSpec(d.TrackType.video, name))
        segment = d.VideoSegment(data['files'][i]['path'], d.trange(clip['startUs'], clip['durationUs']), source_timerange=d.trange(clip['trimInUs'], clip['durationUs']), volume=0 if p['muteOriginal'] else clip['volume'])
        if i > 0:
            transition = next((t for t in p['transitions'] if t['afterClipId'] == p['clips'][i-1]['id']), None)
            if transition:
                segment.add_keyframe(d.KeyframeProperty.alpha, 0, 0)
                segment.add_keyframe(d.KeyframeProperty.alpha, transition['durationUs'], 1)
        script.add_segment(segment, name)
    if p['transitions']:
        limitations.append('Layer opacity keyframes represent the fade; actual Jianying 11.8 rendering still requires a separate open/preview check.')
    for i, audio in enumerate(p['audioTracks']):
        name = 'audio-' + str(i)
        script.append_track(d.TrackSpec(d.TrackType.audio, name))
        seg = d.AudioSegment(data['files'][len(p['clips']) + i]['path'], d.trange(audio['startUs'], audio['durationUs']), source_timerange=d.trange(audio['trimInUs'], audio['durationUs']), volume=audio['volume'])
        if audio['fadeInUs'] or audio['fadeOutUs']:
            seg.add_fade(audio['fadeInUs'], audio['fadeOutUs'])
        script.add_segment(seg, name)
    if p['subtitles']:
        script.append_track(d.TrackSpec(d.TrackType.text, 'captions'))
        for s in p['subtitles']:
            script.add_segment(d.TextSegment(s['text'], d.trange(s['startUs'], s['endUs']-s['startUs']), style=d.TextStyle(size=8), clip_settings=d.ClipSettings(transform_y=-0.8)), 'captions')
    script.save()
    # The reviewed library ships a metadata template with a fixed draft_id and blank paths.
    # Fill only fields already present in that template for this newly created directory.
    with open(os.path.join(target, 'draft_content.json'), encoding='utf-8') as f:
        content = json.load(f)
    meta_path = os.path.join(target, 'draft_meta_info.json')
    with open(meta_path, encoding='utf-8') as f:
        meta = json.load(f)
    meta.update({'draft_id': content['id'], 'draft_name': data['name'], 'draft_fold_path': target, 'draft_root_path': data['draftRoot'], 'tm_duration': p['durationUs']})
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps({'name':data['name'], 'version':'0.3.1', 'draftCreated':True, 'openedInJianying':False, 'automaticallyExported':False, 'limitations':limitations}, ensure_ascii=True))

if __name__ == '__main__':
    main()
