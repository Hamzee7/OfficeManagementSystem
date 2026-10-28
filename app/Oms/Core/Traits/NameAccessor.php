<?php

namespace App\Oms\Core\Traits;

trait NameAccessor
{
    public function getNameAttribute()
    {
        return implode(' ', array_filter([
            $this->getAttribute('first_name'),
            $this->getAttribute('middle_name'),
            $this->getAttribute('last_name'),
        ]));
    }
}