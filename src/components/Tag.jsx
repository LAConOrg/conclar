import { Format } from '../utils/Format'
import configData from '../config.json'
import Icon from './Icon'

const Tag = ({ tag }) => {
  const iconConfig = configData.TAGS.ICONS?.[tag.value];
  return (
    <div className="item-tag">
      {iconConfig && (
        <Icon
          iconName={iconConfig.ICON_NAME}
          iconUrl={iconConfig.ICON_URL}
          className="tag-icon"
        />
      )}
      {Format.formatTag(tag.label)}
    </div>
  );
};

export default Tag;
